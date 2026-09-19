import fs from 'node:fs';
import path from 'node:path';
import type { Paths } from '../config';
import type { Db } from '../db/open';
import type { ParsedStatement } from '../adapters/types';
import { accountLabel } from '../core/labels';
import { monthLabel } from '../core/dates';
import { classifyAll } from '../classify/run';
import { loadSettings } from '../settings';
import { accountKey, readPdf, storedReceipt, storeParsed, summarise, type ImportDeps, type ParsedFile, type ReceiptItem } from './importer';

type FileRow = { id: number; original_name: string; vault_path: string; imported_at: string };

/** Thrown inside a file's savepoint to undo just that file. */
class KeepFile extends Error {}

/** A file whose old rows stay because its new reading cannot replace them. */
const kept = (why: string) => `${why.replace(/\.$/, '')}. Kept as it was.`;

/**
 * "Rebuild from vault" (PRD §5): re-read every PDF in the vault with today's adapters.
 *
 * Nothing is lost on the way. Every file is read and parsed before anything is written. A file
 * that no longer reads (missing, locked, not recognised, or throwing) keeps its old rows. The
 * rest are replaced in one transaction, each file in its own savepoint, so a file whose new
 * reading clashes with a statement already here also keeps its old rows. Sorting runs inside the
 * same transaction, so a failure there changes nothing. Import dates carry over, and so does
 * "accept these totals" for a statement that reads the same. Decisions, rules and manual
 * entries are never touched, and decisions are keyed by fingerprint, so they apply again.
 */
export async function rebuildFromVault(
  db: Db,
  paths: Paths,
  deps: ImportDeps = {},
): Promise<{ items: ReceiptItem[]; summary: string; unmatchedDecisions: number }> {
  const files = db.prepare('SELECT id, original_name, vault_path, imported_at FROM files ORDER BY month, id').all() as FileRow[];

  const items: ReceiptItem[] = new Array(files.length);
  const ready: { index: number; file: FileRow; parsed: ParsedFile }[] = [];
  for (const [index, f] of files.entries()) {
    const full = path.join(paths.vaultDir, f.vault_path);
    if (!fs.existsSync(full)) {
      items[index] = { name: f.original_name, status: 'error', detail: kept('The vault copy is missing') };
      continue;
    }
    try {
      const read = await readPdf({ name: f.original_name, data: new Uint8Array(fs.readFileSync(full)) }, deps);
      if ('receipt' in read) items[index] = { ...read.receipt, detail: kept(read.receipt.detail) };
      else ready.push({ index, file: f, parsed: { ...read.parsed, name: f.original_name } });
    } catch (e) {
      items[index] = { name: f.original_name, status: 'error', detail: kept(`Could not read it: ${(e as Error).message}`) };
    }
  }

  // Settings first: if they cannot be read, stop before anything changes.
  const settings = loadSettings(paths);

  // "Accept these totals" carries over only to the same statement, read with the same opening
  // and closing. A statement that now reads differently must be looked at again.
  const accepted = new Set(
    (
      db
        .prepare('SELECT a.key, st.month, st.opening_cents, st.closing_cents FROM statements st JOIN accounts a ON a.id = st.account_id WHERE st.accepted = 1')
        .all() as { key: string; month: string; opening_cents: number; closing_cents: number }[]
    ).map((r) => `${r.key}|${r.month}|${r.opening_cents}|${r.closing_cents}`),
  );

  const existing = db.prepare(
    'SELECT st.opening_cents, st.closing_cents FROM statements st JOIN accounts a ON a.id = st.account_id WHERE a.key = ? AND st.month = ?',
  );

  db.transaction(() => {
    for (const { index, file, parsed } of ready) {
      try {
        items[index] = db.transaction((): ReceiptItem => {
          // Files cascade to statements, and statements to their rows.
          db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
          const fresh: ParsedStatement[] = [];
          for (const s of parsed.statements) {
            const e = existing.get(accountKey(s.account), s.period.month) as { opening_cents: number; closing_cents: number } | undefined;
            if (!e) fresh.push(s);
            else if (e.opening_cents !== s.openingCents || e.closing_cents !== s.closingCents) {
              throw new KeepFile(kept(`It now reads as ${accountLabel(s.account)}, ${monthLabel(s.period.month)}, which another file already covers`));
            }
          }
          if (!fresh.length) throw new KeepFile(kept('Every statement in it is already in another file'));
          const stored = storeParsed(db, parsed, fresh, { vaultPath: file.vault_path, importedAt: file.imported_at, accepted });
          return storedReceipt(parsed.name, fresh, stored);
        })();
      } catch (e) {
        if (!(e instanceof KeepFile)) throw e;
        items[index] = { name: file.original_name, status: 'conflict', detail: e.message };
      }
    }
    // Inside the same transaction: if sorting fails, every file keeps its old rows.
    classifyAll(db, settings);
  })();

  const unmatchedDecisions = (
    db.prepare('SELECT COUNT(*) n FROM decisions d WHERE NOT EXISTS (SELECT 1 FROM transactions t WHERE t.fingerprint = d.fingerprint)').get() as { n: number }
  ).n;
  let summary = summarise(items);
  if (unmatchedDecisions) summary += ` ${unmatchedDecisions} of your decisions ${unmatchedDecisions === 1 ? 'matches' : 'match'} no row now. They are kept in case the row comes back.`;
  return { items, summary, unmatchedDecisions };
}

