import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Paths } from '../config';
import type { Db } from '../db/open';
import { detectAdapter } from '../adapters';
import type { AccountRef, ParsedStatement, PdfDoc } from '../adapters/types';
import { dayLabel, monthLabel, sgtDate } from '../core/dates';
import { assignFingerprints } from '../core/fingerprint';
import { accountLabel } from '../core/labels';
import { formatSGD } from '../core/money';
import { redact } from '../core/redact';
import { extractPdf, PdfPasswordError } from '../pdf/extract';
import { reconcile, type ReconcileResult } from '../reconcile';
import { stageVault, vaultRelPath, type StagedFile } from './vault';

export { vaultRelPath } from './vault';

/**
 * - imported: stored, and every statement in it reconciles
 * - duplicate: already here (same file, or the same statements from another file)
 * - unrecognised: not a layout Tally knows, or not a readable PDF
 * - failed: stored, but at least one statement's rows do not match its printed totals
 * - locked: needs its password
 * - conflict: a different statement for the same account and month is already here
 * - error: something went wrong while importing; nothing was stored
 */
export type ReceiptStatus = 'imported' | 'duplicate' | 'unrecognised' | 'failed' | 'locked' | 'conflict' | 'error';

export interface ReceiptItem {
  name: string;
  status: ReceiptStatus;
  detail: string;
  statements?: { account: string; month: string; rows: number; reconciled: boolean }[];
}

export interface ImportDeps {
  extract?: (data: Uint8Array, password?: string) => Promise<PdfDoc>;
  now?: () => Date;
  /** Test seam for the vault write. */
  stageVault?: (vaultDir: string, rel: string, data: Uint8Array) => StagedFile;
}

export interface ImportFile {
  name: string;
  data: Uint8Array;
  /** Used for this one read only. Never stored or logged. */
  password?: string;
}

export const RAW_JOIN = ' · ';

export function accountKey(a: Pick<AccountRef, 'kind' | 'last4' | 'currency'>): string {
  return `${a.kind}:${a.last4}:${a.currency}`;
}

/** First-pass payee: the most specific description line. Classification replaces it. */
export function firstPassPayee(lines: string[]): string {
  for (const l of lines) {
    const m = /^(?:TO|FROM|To|From):\s*(.+)$/.exec(l);
    if (m) return m[1]!.trim();
  }
  return (lines.length > 1 ? lines[1] : lines[0]) ?? '';
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function labels(statements: ParsedStatement[]): string {
  const seen: string[] = [];
  for (const s of statements) {
    // An empty foreign-currency sub-account (DBS's USD pocket) is noise in a receipt.
    if (s.account.currency !== 'SGD' && s.rows.length === 0) continue;
    const l = accountLabel(s.account);
    if (!seen.includes(l)) seen.push(l);
  }
  return seen.join(', ');
}

function failureDetail(results: { s: ParsedStatement; rec: ReconcileResult }[]): string {
  const bad = results.find((r) => !r.rec.ok)!;
  const c = bad.rec.checks.find((x) => !x.ok)!;
  if (/found$/.test(c.name)) return `Totals don’t match: ${c.name.toLowerCase().replace(/found$/, 'not found')}`;
  return `Totals don’t match: ${c.name} (statement says ${formatSGD(c.expected)}, rows add up to ${formatSGD(c.actual)})`;
}

type Existing = { opening_cents: number; closing_cents: number } | undefined;

/** The statement already stored for this account and month, if any. */
function existingStatement(db: Db, s: ParsedStatement): Existing {
  return db
    .prepare(
      `SELECT st.opening_cents, st.closing_cents FROM statements st JOIN accounts a ON a.id = st.account_id
       WHERE a.key = ? AND st.month = ?`,
    )
    .get(accountKey(s.account), s.period.month) as Existing;
}

function upsertAccount(db: Db, a: AccountRef, month: string): number {
  const key = accountKey(a);
  const existing = db.prepare('SELECT id, seen_only_as_target FROM accounts WHERE key = ?').get(key) as
    | { id: number; seen_only_as_target: number }
    | undefined;
  if (!existing) {
    const r = db
      .prepare('INSERT INTO accounts (key, bank, product, kind, last4, currency, owner) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(key, a.bank, a.product, a.kind, a.last4, a.currency, a.owner);
    return Number(r.lastInsertRowid);
  }
  // Banks rename products over time; keep the name from the latest statement.
  const latest = db.prepare('SELECT MAX(month) AS m FROM statements WHERE account_id = ?').get(existing.id) as { m: string | null };
  if (!latest.m || month >= latest.m) {
    db.prepare('UPDATE accounts SET bank = ?, product = ? WHERE id = ?').run(a.bank, a.product, existing.id);
  }
  if (existing.seen_only_as_target) {
    db.prepare('UPDATE accounts SET seen_only_as_target = 0, owner = ? WHERE id = ?').run(a.owner, existing.id);
  }
  return existing.id;
}

export async function importPdf(db: Db, paths: Paths, file: ImportFile, deps: ImportDeps = {}): Promise<ReceiptItem> {
  const extract = deps.extract ?? extractPdf;
  const now = (deps.now ?? (() => new Date()))();
  const name = redact(path.basename(file.name));
  const sha = sha256(file.data);

  const prior = db.prepare('SELECT imported_at FROM files WHERE sha256 = ?').get(sha) as { imported_at: string } | undefined;
  if (prior) return { name, status: 'duplicate', detail: `Already here, imported ${dayLabel(sgtDate(prior.imported_at))}` };

  let doc: PdfDoc;
  try {
    doc = await extract(file.data, file.password);
  } catch (e) {
    if (e instanceof PdfPasswordError) {
      return { name, status: 'locked', detail: e.reason === 'incorrect' ? 'That password did not open it' : 'This PDF needs its password' };
    }
    return { name, status: 'unrecognised', detail: 'Tally could not read this file as a PDF' };
  }

  const hit = detectAdapter(doc);
  if (!hit) return { name, status: 'unrecognised', detail: 'Not a statement layout Tally knows yet (DBS, POSB and UOB so far)' };
  let parsed: ParsedStatement[];
  try {
    parsed = hit.adapter.parse(doc);
  } catch {
    parsed = [];
  }
  if (!parsed.length) return { name, status: 'unrecognised', detail: `Looks like ${hit.adapter.bank}, but the layout did not parse` };

  // Each statement on its own: already here, clashing with one already here, or new.
  const fresh: ParsedStatement[] = [];
  for (const s of parsed) {
    const e = existingStatement(db, s);
    if (!e) fresh.push(s);
    else if (e.opening_cents !== s.openingCents || e.closing_cents !== s.closingCents) {
      return {
        name,
        status: 'conflict',
        detail: `A different statement for ${accountLabel(s.account)}, ${monthLabel(s.period.month)} is already here. Remove that one first.`,
      };
    }
  }
  if (!fresh.length) return { name, status: 'duplicate', detail: 'Same statement as one already here' };

  const results = fresh.map((s) => ({ s, rec: reconcile(s) }));
  const month = fresh.map((s) => s.period.month).sort().at(-1)!;
  const first = fresh[0]!.account;
  const distinct = new Set(fresh.map((s) => s.account.last4));
  const rel =
    distinct.size === 1
      ? vaultRelPath(first.bank, first.product, first.last4, month, hit.adapter.kind)
      : vaultRelPath(first.bank, first.kind === 'card' ? 'cards' : 'accounts', '', month, hit.adapter.kind);

  const staged = (deps.stageVault ?? stageVault)(paths.vaultDir, rel, file.data);
  let inserted = 0;
  let skipped = 0;
  try {
    db.transaction(() => {
      const fileId = Number(
        db
          .prepare('INSERT INTO files (sha256, original_name, vault_path, adapter_id, adapter_version, month, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(sha, name, staged.rel, hit.adapter.id, hit.adapter.version, month, now.toISOString()).lastInsertRowid,
      );
      const insertRow = db.prepare(
        `INSERT INTO transactions
         (statement_id, account_id, seq, date, post_date, raw, payee, amount_cents, currency, balance_cents, fx_currency, fx_amount_cents, cardholder, card_last4, fingerprint)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (fingerprint) DO NOTHING`,
      );
      for (const { s, rec } of results) {
        const accountId = upsertAccount(db, s.account, s.period.month);
        const statementId = Number(
          db
            .prepare(
              `INSERT INTO statements (file_id, account_id, month, period_start, period_end, opening_cents, closing_cents, printed_json, checks_json, reconciled, meta_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(fileId, accountId, s.period.month, s.period.start, s.period.end, s.openingCents, s.closingCents, JSON.stringify(s.printed), JSON.stringify(rec.checks), rec.ok ? 1 : 0, JSON.stringify(s.meta ?? {}))
            .lastInsertRowid,
        );
        // Fingerprints come from the text as printed, so redaction rules never move them.
        const rows = assignFingerprints(
          accountKey(s.account),
          s.rows.map((r) => ({ ...r, raw: r.lines.join(RAW_JOIN) })),
        );
        let statementSkipped = 0;
        rows.forEach((r, seq) => {
          const res = insertRow.run(
            statementId,
            accountId,
            seq,
            r.date,
            r.postDate ?? null,
            redact(r.raw),
            redact(firstPassPayee(r.lines)),
            r.amountCents,
            s.account.currency,
            r.balanceCents ?? null,
            r.fx?.currency ?? null,
            r.fx?.amountCents ?? null,
            r.cardholder ?? null,
            r.cardLast4 ?? null,
            r.fingerprint,
          );
          if (res.changes) inserted++;
          else statementSkipped++;
        });
        if (statementSkipped) db.prepare('UPDATE statements SET rows_skipped = ? WHERE id = ?').run(statementSkipped, statementId);
        skipped += statementSkipped;
      }
      // Last step inside the transaction: if the vault copy cannot be moved into place (a sync
      // or antivirus lock), the whole import rolls back and the file can simply be dropped again.
      staged.commit();
    })();
  } catch (e) {
    staged.discard();
    throw e;
  }

  const allOk = results.every((r) => r.rec.ok);
  const rowsText = `${inserted} ${inserted === 1 ? 'row' : 'rows'}${skipped ? `, ${skipped} already here` : ''}`;
  return {
    name,
    status: allOk ? 'imported' : 'failed',
    detail: allOk ? `${labels(fresh)}, ${monthLabel(month)}, ${rowsText}` : failureDetail(results),
    statements: results.map(({ s, rec }) => ({ account: accountLabel(s.account), month: s.period.month, rows: s.rows.length, reconciled: rec.ok })),
  };
}

const SUMMARY: [ReceiptStatus, (n: number) => string][] = [
  ['imported', (n) => `${n} ${n === 1 ? 'statement' : 'statements'} imported`],
  ['duplicate', (n) => `${n} already here`],
  ['unrecognised', (n) => `${n} not recognised`],
  ['failed', (n) => `${n} with totals that don’t match`],
  ['locked', (n) => `${n} ${n === 1 ? 'needs a password' : 'need a password'}`],
  ['conflict', (n) => `${n} ${n === 1 ? 'clashes' : 'clash'} with a statement already here`],
  ['error', (n) => `${n} could not be imported`],
];

export function summarise(items: ReceiptItem[]): string {
  const parts = SUMMARY.flatMap(([status, text]) => {
    const n = items.filter((i) => i.status === status).length;
    return n ? [text(n)] : [];
  });
  if (!items.some((i) => i.status === 'imported')) parts.unshift('No new statements');
  return parts.map((p) => `${p[0]!.toUpperCase()}${p.slice(1)}.`).join(' ');
}

/** Imports one file after another. A file that throws gets an "error" receipt; the rest still import. */
export async function importFiles(db: Db, paths: Paths, files: ImportFile[], deps: ImportDeps = {}): Promise<{ items: ReceiptItem[]; summary: string }> {
  const items: ReceiptItem[] = [];
  for (const f of files) {
    try {
      items.push(await importPdf(db, paths, f, deps));
    } catch (e) {
      items.push({ name: redact(path.basename(f.name)), status: 'error', detail: `Could not import this file: ${(e as Error).message}` });
    }
  }
  return { items, summary: summarise(items) };
}

/** Every *.pdf under the given folders, recursively, sorted. Missing folders are skipped. */
export function findPdfs(dirs: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.toLowerCase().endsWith('.pdf')) out.push(p);
    }
  };
  for (const d of dirs) walk(d);
  return out.sort();
}

const HASH_COLUMNS = new Set(['sha256', 'fingerprint', 'pair_fingerprint']);
/** Stricter than redaction on purpose: no word boundaries, and digits may be split by single spaces or dashes. */
const SCAN_NRIC = /[STFGM]\d{7}[A-Z]/g;
const SCAN_RUN = /\d(?:[ -]?\d){7,}/g;
const SCAN_DATE = /^(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})$/;

function scanText(text: string, jsonColumn: boolean): string[] {
  const found: string[] = [];
  if (SCAN_NRIC.test(text)) found.push('[NRIC]');
  SCAN_NRIC.lastIndex = 0;
  if (jsonColumn) return found; // amounts in cents live here
  for (const m of text.match(SCAN_RUN) ?? []) {
    if (!SCAN_DATE.test(m)) found.push(m.replace(/\d(?=(?:[ -]?\d){4})/g, '•').replace(/[ -]/g, ''));
  }
  return found;
}

/**
 * Scans every text column of every table for NRICs and 8+ digit numbers (PRD §4.9). It is
 * deliberately stricter than redaction, so it can catch what redaction missed. Hash columns
 * are skipped; *_json columns hold amounts in cents, so they are checked for NRICs only.
 * Hits come back with all but the last four digits masked.
 */
export function scanDatabase(db: Db): { table: string; column: string; found: string }[] {
  const hits: { table: string; column: string; found: string }[] = [];
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
  for (const { name } of tables) {
    const cols = (db.prepare(`PRAGMA table_info(${name})`).all() as { name: string; type: string }[]).filter((c) => c.type === 'TEXT');
    for (const c of cols) {
      if (HASH_COLUMNS.has(c.name)) continue;
      for (const row of db.prepare(`SELECT ${c.name} AS v FROM ${name} WHERE ${c.name} IS NOT NULL`).all() as { v: string }[]) {
        for (const f of scanText(String(row.v), c.name.endsWith('_json'))) hits.push({ table: name, column: c.name, found: f });
      }
    }
  }
  return hits;
}
