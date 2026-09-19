import type { Db } from '../db/open';
import { addMonths, monthEnd, sgtDate } from '../core/dates';

/**
 * A row counts towards totals when it is in SGD and either a manual entry or from a statement
 * that reconciled (or that Ting Yu accepted). PRD §4.2: held rows stay out of every total.
 */
export const COUNTED = `t.currency = 'SGD' AND (t.statement_id IS NULL OR EXISTS (
  SELECT 1 FROM statements s WHERE s.id = t.statement_id AND (s.reconciled = 1 OR s.accepted = 1)))`;

/**
 * A spending row that belongs to the home project: category Home project, or tagged with a
 * bucket. Overview and the Home project screen share this, so their figures always agree.
 */
export const IN_PROJECT = `t.kind IN ('spend', 'fee', 'tax') AND (t.category = 'Home project' OR t.bucket IS NOT NULL)`;

export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

/**
 * Every month from the earliest to the latest statement. Manual entries widen the range by at
 * most a year before the first statement and never past the current month, so one old or
 * mistyped date cannot add dozens of empty months.
 */
export function dataMonths(db: Db, today = sgtDate(new Date().toISOString())): string[] {
  const s = db.prepare('SELECT MIN(month) lo, MAX(month) hi FROM statements').get() as { lo: string | null; hi: string | null };
  const now = today.slice(0, 7);
  const floor = s.lo ? addMonths(s.lo, -12) : addMonths(now, -12);
  const m = db
    .prepare("SELECT MIN(substr(date, 1, 7)) lo, MAX(substr(date, 1, 7)) hi FROM transactions WHERE manual = 1 AND substr(date, 1, 7) BETWEEN ? AND ?")
    .get(floor, now) as { lo: string | null; hi: string | null };
  const lo = [s.lo, m.lo].filter((x): x is string => !!x).sort()[0];
  const hi = [s.hi, m.hi].filter((x): x is string => !!x).sort().at(-1);
  return lo && hi ? monthRange(lo, hi) : [];
}

export function monthBounds(month: string): [string, string] {
  return [`${month}-01`, monthEnd(month)];
}
