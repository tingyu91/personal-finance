import type { Db } from '../db/open';
import { toView, VIEW_SELECT, type TransactionView, type ViewRow } from '../queries/transactions';
import { COUNTED, monthBounds } from './months';

export interface LedgerFilters {
  month?: string;
  accountId?: number;
  category?: string;
  kind?: string;
  review?: boolean;
  q?: string;
  /** Only these rows (an insight's evidence). An empty list matches nothing. */
  fingerprints?: string[];
  limit?: number;
  offset?: number;
}

export interface Ledger {
  rows: TransactionView[];
  total: number;
  /** Sum of the matching rows' money out (negative) and in: SGD rows that count only. */
  outCents: number;
  inCents: number;
  /** Matching rows left out of the sums: held statements and foreign currency. */
  notCounted: number;
}

const MAX_LIMIT = 1000;

/** The Transactions screen's query: newest first, filtered, with totals for the whole match. */
export function listTransactions(db: Db, f: LedgerFilters): Ledger {
  const where: string[] = [];
  const args: unknown[] = [];
  if (f.month) {
    where.push('t.date BETWEEN ? AND ?');
    args.push(...monthBounds(f.month));
  }
  if (f.accountId !== undefined) {
    where.push('t.account_id = ?');
    args.push(f.accountId);
  }
  if (f.category) {
    where.push('t.category = ?');
    args.push(f.category);
  }
  if (f.kind) {
    where.push('t.kind = ?');
    args.push(f.kind);
  }
  if (f.review) where.push('t.needs_review = 1');
  if (f.fingerprints) {
    if (!f.fingerprints.length) where.push('0');
    else {
      where.push(`t.fingerprint IN (${f.fingerprints.map(() => '?').join(', ')})`);
      args.push(...f.fingerprints);
    }
  }
  if (f.q?.trim()) {
    where.push('(t.payee LIKE ? OR t.raw LIKE ? OR t.note LIKE ?)');
    const like = `%${f.q.trim().replace(/[%_]/g, (c) => `\\${c}`)}%`;
    args.push(like, like, like);
  }
  const clause = where.length ? `WHERE ${where.map((w) => w.replace(/LIKE \?/g, "LIKE ? ESCAPE '\\'")).join(' AND ')}` : '';
  const totals = db
    .prepare(
      `SELECT COUNT(*) n,
              COALESCE(SUM(CASE WHEN t.amount_cents < 0 AND ${COUNTED} THEN t.amount_cents END), 0) o,
              COALESCE(SUM(CASE WHEN t.amount_cents > 0 AND ${COUNTED} THEN t.amount_cents END), 0) i,
              COALESCE(SUM(CASE WHEN ${COUNTED} THEN 0 ELSE 1 END), 0) x
       FROM transactions t ${clause}`,
    )
    .get(...args) as { n: number; o: number; i: number; x: number };
  const limit = Math.min(Math.max(f.limit ?? 200, 1), MAX_LIMIT);
  const rows = db
    .prepare(`${VIEW_SELECT} ${clause} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`)
    .all(...args, limit, Math.max(f.offset ?? 0, 0)) as ViewRow[];
  return { rows: rows.map(toView), total: totals.n, outCents: totals.o, inCents: totals.i, notCounted: totals.x };
}
