import { randomUUID } from 'node:crypto';
import type { Paths } from './config';
import type { Db } from './db/open';
import { BUCKETS, isCategory, isKind, type Kind } from './classify/categories';
import { classifyAll } from './classify/run';
import { DecisionError, validateShape } from './decisions';
import { addDays, isoFromDmy, sgtDate } from './core/dates';
import { redact } from './core/redact';
import { getTransaction, type TransactionView } from './queries/transactions';
import { loadSettings } from './settings';

/**
 * Manual entries for cash, cheques or anything paid outside a statement (PRD §5), such as a
 * renovation deposit. Stored as a row plus its decision, so "Rebuild from vault" keeps them.
 */
export class ManualEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManualEntryError';
  }
}

export interface ManualEntry {
  date: string;
  /** Negative is money out. */
  amountCents: number;
  payee: string;
  kind: Kind;
  category?: string | null;
  accountId?: number | null;
  bucket?: string | null;
  note?: string | null;
}

function validDate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return !!m && isoFromDmy(`${m[3]}/${m[2]}/${m[1]}`) === iso;
}

export function addManualEntry(db: Db, paths: Paths, e: ManualEntry, today = sgtDate(new Date().toISOString())): TransactionView {
  if (typeof e.date !== 'string' || !validDate(e.date)) throw new ManualEntryError('Give the date as YYYY-MM-DD.');
  if (e.date < '2000-01-01' || e.date > addDays(today, 31)) throw new ManualEntryError('That date is too far from today. Check the year.');
  if (typeof e.payee !== 'string') throw new ManualEntryError('Say who was paid.');
  for (const [k, v] of [['category', e.category], ['bucket', e.bucket], ['note', e.note]] as const) {
    if (v !== undefined && v !== null && typeof v !== 'string') throw new ManualEntryError(`The ${k} must be text.`);
  }
  if (!Number.isInteger(e.amountCents) || e.amountCents === 0) throw new ManualEntryError('The amount cannot be zero.');
  if (!e.payee?.trim()) throw new ManualEntryError('Say who was paid.');
  if (!isKind(e.kind)) throw new ManualEntryError(`“${e.kind}” is not a kind Tally knows.`);
  if (e.category && !isCategory(e.category)) throw new ManualEntryError(`“${e.category}” is not a category Tally knows.`);
  if (e.bucket && !(BUCKETS as readonly string[]).includes(e.bucket)) throw new ManualEntryError(`“${e.bucket}” is not a home project bucket.`);
  if (e.accountId != null && (!Number.isInteger(e.accountId) || !db.prepare('SELECT 1 FROM accounts WHERE id = ?').get(e.accountId))) {
    throw new ManualEntryError('That account is not here.');
  }
  try {
    validateShape({ kind: e.kind, category: e.category ?? null, bucket: e.bucket ?? null });
  } catch (err) {
    if (err instanceof DecisionError) throw new ManualEntryError(err.message);
    throw err;
  }

  const fingerprint = `manual:${randomUUID()}`;
  const payee = redact(e.payee.trim());
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO transactions (statement_id, account_id, date, raw, payee, amount_cents, currency, fingerprint, manual)
       VALUES (NULL, ?, ?, 'Manual entry', ?, ?, 'SGD', ?, 1)`,
    ).run(e.accountId ?? null, e.date, payee, e.amountCents, fingerprint);
    db.prepare('INSERT INTO decisions (fingerprint, kind, category, bucket, note, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      fingerprint,
      e.kind,
      e.category ?? null,
      e.bucket ?? null,
      e.note ? redact(e.note) : null,
      now,
    );
  })();
  classifyAll(db, loadSettings(paths));
  return getTransaction(db, fingerprint)!;
}

export function deleteManualEntry(db: Db, paths: Paths, fingerprint: string): void {
  const row = db.prepare('SELECT manual FROM transactions WHERE fingerprint = ?').get(fingerprint) as { manual: number } | undefined;
  if (!row) throw new ManualEntryError('That entry is not here any more.');
  if (row.manual !== 1) throw new ManualEntryError('Only manual entries can be deleted. Statement rows come and go with their statement.');
  db.transaction(() => {
    db.prepare('DELETE FROM transactions WHERE fingerprint = ?').run(fingerprint);
    db.prepare('DELETE FROM decisions WHERE fingerprint = ?').run(fingerprint);
  })();
  classifyAll(db, loadSettings(paths));
}
