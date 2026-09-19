import fs from 'node:fs';
import path from 'node:path';
import type { Paths } from '../config';
import type { Db } from '../db/open';
import { accountLabel } from '../core/labels';
import { formatSGD } from '../core/money';
import { classifyAll } from '../classify/run';
import { loadSettings } from '../settings';
import type { Check } from '../reconcile';

export interface StatementView {
  id: number;
  account: string;
  accountId: number;
  month: string;
  periodStart: string;
  periodEnd: string;
  rows: number;
  reconciled: boolean;
  accepted: boolean;
  /** The first check that failed, in words, when the statement does not reconcile. */
  failure: string | null;
}

export interface FileView {
  id: number;
  name: string;
  month: string;
  importedAt: string;
  adapter: string;
  statements: StatementView[];
}

function describe(checks: Check[]): string | null {
  const c = checks.find((x) => !x.ok);
  if (!c) return null;
  if (/found$/.test(c.name)) return `${c.name.replace(/ found$/, '')} not found on the statement`;
  return `${c.name}: statement says ${formatSGD(c.expected)}, rows add up to ${formatSGD(c.actual)}`;
}

export function listFiles(db: Db): FileView[] {
  const files = db.prepare('SELECT id, original_name, month, imported_at, adapter_id FROM files ORDER BY month DESC, imported_at DESC, id DESC').all() as {
    id: number;
    original_name: string;
    month: string;
    imported_at: string;
    adapter_id: string;
  }[];
  const stmt = db.prepare(
    `SELECT s.id, s.account_id, s.month, s.period_start, s.period_end, s.reconciled, s.accepted, s.checks_json,
            a.bank, a.product, a.last4, a.label, a.currency,
            (SELECT COUNT(*) FROM transactions t WHERE t.statement_id = s.id) n
     FROM statements s JOIN accounts a ON a.id = s.account_id WHERE s.file_id = ? ORDER BY a.kind, a.bank, a.product`,
  );
  return files.map((f) => ({
    id: f.id,
    name: f.original_name,
    month: f.month,
    importedAt: f.imported_at,
    adapter: f.adapter_id,
    statements: (
      stmt.all(f.id) as {
        id: number;
        account_id: number;
        month: string;
        period_start: string;
        period_end: string;
        reconciled: number;
        accepted: number;
        checks_json: string;
        bank: string;
        product: string;
        last4: string;
        label: string | null;
        currency: string;
        n: number;
      }[]
    ).map((s) => ({
      id: s.id,
      account: accountLabel(s),
      accountId: s.account_id,
      month: s.month,
      periodStart: s.period_start,
      periodEnd: s.period_end,
      rows: s.n,
      reconciled: s.reconciled === 1,
      accepted: s.accepted === 1,
      failure: s.reconciled === 1 ? null : describe(JSON.parse(s.checks_json) as Check[]),
    })),
  }));
}

/**
 * You have looked at a statement that does not reconcile and want its rows counted. Its rows
 * were kept out of pairing while held, so everything is sorted again.
 */
export function acceptStatement(db: Db, paths: Paths, statementId: number): boolean {
  const ok = db.prepare('UPDATE statements SET accepted = 1 WHERE id = ? AND reconciled = 0').run(statementId).changes > 0;
  if (ok) classifyAll(db, loadSettings(paths));
  return ok;
}

/** Removes an imported file with its statements, rows and vault copy. Decisions stay (keyed by fingerprint). */
export function removeFile(db: Db, paths: Paths, fileId: number): boolean {
  const f = db.prepare('SELECT vault_path FROM files WHERE id = ?').get(fileId) as { vault_path: string } | undefined;
  if (!f) return false;
  const settings = loadSettings(paths);
  db.transaction(() => {
    db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
    // Sort again first, so pairs that pointed at the removed rows' account are gone.
    classifyAll(db, settings);
    // An account whose only statements were in this file: a card still repaid from your
    // accounts becomes one Tally only sees as a repayment target (its repayments are unseen
    // money again); anything else nothing points at goes.
    const orphan = 'seen_only_as_target = 0 AND NOT EXISTS (SELECT 1 FROM statements s WHERE s.account_id = accounts.id)';
    db.prepare(
      `UPDATE accounts SET seen_only_as_target = 1 WHERE ${orphan} AND kind = 'card'
         AND EXISTS (SELECT 1 FROM transactions t WHERE t.target_account_id = accounts.id)`,
    ).run();
    db.prepare(
      `DELETE FROM accounts WHERE ${orphan}
         AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.account_id = accounts.id OR t.target_account_id = accounts.id)`,
    ).run();
  })();
  // Only once the database has let go of the file.
  fs.rmSync(path.join(paths.vaultDir, f.vault_path), { force: true });
  return true;
}

export function vaultFile(db: Db, paths: Paths, fileId: number): { full: string; name: string } | null {
  const f = db.prepare('SELECT vault_path, original_name FROM files WHERE id = ?').get(fileId) as { vault_path: string; original_name: string } | undefined;
  if (!f) return null;
  const full = path.join(paths.vaultDir, f.vault_path);
  return fs.existsSync(full) ? { full, name: f.original_name } : null;
}
