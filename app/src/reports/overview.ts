import type { Db } from '../db/open';
import { addMonths } from '../core/dates';
import { accountLabel } from '../core/labels';
import { CATEGORIES } from '../classify/categories';
import { coverage } from './coverage';
import { COUNTED, dataMonths, IN_PROJECT, monthBounds } from './months';

export interface CategoryBar {
  name: string;
  slot: number;
  cents: number;
  /** Median of this category's monthly spending over the six months before; null with no history. */
  medianCents: number | null;
}

export interface OverviewData {
  month: string;
  months: string[];
  /** Everyday spending: spend, fees and tax, without the home project. */
  spentCents: number;
  homeProjectCents: number;
  taxCents: number;
  feesCents: number;
  incomeCents: number;
  /** Income less all spending, home project included. */
  netCents: number;
  savingsRate: number | null;
  investedCents: number;
  partnerCents: number;
  cashOnHandCents: number;
  cashStale: string[];
  cashTrend: { month: string; cents: number }[];
  /** Everyday spending by category, largest first. The home project is left out (see homeProjectCents). */
  categories: CategoryBar[];
  notSorted: { count: number; outCents: number; inCents: number };
  /**
   * missing: accounts with no statement for the month. partial: accounts whose statements stop
   * before the month ends (card periods run 21st to 20th). held: statements that do not add up.
   */
  coverage: { complete: boolean; missing: string[]; partial: { account: string; through: string }[]; unseenCents: number; held: string[] };
}

/** Negates without producing -0. */
const neg = (n: number): number => (n === 0 ? 0 : -n);

function median(ns: number[]): number | null {
  if (!ns.length) return null;
  const s = [...ns].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

/** Everyday spending per category for one month: no home project rows; fees and tax are reported apart. */
function categorySpend(db: Db, month: string): Map<string, number> {
  const [from, to] = monthBounds(month);
  const rows = db
    .prepare(
      `SELECT COALESCE(t.category, 'Other') c, -SUM(t.amount_cents) n FROM transactions t
       WHERE t.kind = 'spend' AND NOT (${IN_PROJECT}) AND t.date BETWEEN ? AND ? AND ${COUNTED} GROUP BY c`,
    )
    .all(from, to) as { c: string; n: number }[];
  return new Map(rows.map((r) => [CATEGORIES.some((k) => k.name === r.c) ? r.c : 'Other', r.n]));
}

function cashAt(db: Db, month: string): { cents: number; stale: string[] } {
  const rows = db
    .prepare(
      `SELECT a.bank, a.product, a.last4, a.label, st.month, st.closing_cents FROM accounts a
       JOIN statements st ON st.id = (
         SELECT s2.id FROM statements s2 WHERE s2.account_id = a.id AND s2.month <= ? ORDER BY s2.month DESC LIMIT 1)
       WHERE a.kind = 'deposit' AND a.currency = 'SGD' AND a.seen_only_as_target = 0`,
    )
    .all(month) as { bank: string; product: string; last4: string; label: string | null; month: string; closing_cents: number }[];
  return {
    cents: rows.reduce((t, r) => t + r.closing_cents, 0),
    stale: rows.filter((r) => r.month < month).map((r) => accountLabel(r)),
  };
}

/**
 * Accounts marked as covered for the month whose statements stop before it ends. A card whose
 * statement runs to the 20th has no rows here yet for the 21st onwards.
 */
function partialCoverage(db: Db, cov: ReturnType<typeof coverage>, month: string): { account: string; through: string }[] {
  const [from, to] = monthBounds(month);
  const mi = cov.months.indexOf(month);
  if (mi < 0) return [];
  const overlapping = db
    .prepare(
      `SELECT st.account_id, st.period_end, f.adapter_id FROM statements st JOIN files f ON f.id = st.file_id
       WHERE st.period_start <= ? AND st.period_end >= ?`,
    )
    .all(to, from) as { account_id: number; period_end: string; adapter_id: string }[];
  const byAccount = new Map<number, string>();
  const byAdapter = new Map<string, string>();
  for (const s of overlapping) {
    if ((byAccount.get(s.account_id) ?? '') < s.period_end) byAccount.set(s.account_id, s.period_end);
    if ((byAdapter.get(s.adapter_id) ?? '') < s.period_end) byAdapter.set(s.adapter_id, s.period_end);
  }
  const adapterOf = new Map(
    (db.prepare('SELECT DISTINCT st.account_id, f.adapter_id FROM statements st JOIN files f ON f.id = st.file_id').all() as { account_id: number; adapter_id: string }[]).map(
      (r) => [r.account_id, r.adapter_id],
    ),
  );
  const out: { account: string; through: string }[] = [];
  for (const r of cov.rows) {
    if (r.seenOnly || r.accountId === null || r.cells[mi] !== 'ok') continue;
    const adapter = adapterOf.get(r.accountId);
    // A card with no activity is left off the combined file, so the file's own period counts too.
    const own = byAccount.get(r.accountId);
    const shared = r.kind === 'card' && adapter ? byAdapter.get(adapter) : undefined;
    const through = [own, shared].filter((d): d is string => !!d).sort().at(-1);
    if (through && through < to) out.push({ account: r.account, through });
  }
  return out;
}

export function overview(db: Db, month: string): OverviewData {
  const months = dataMonths(db);
  const [from, to] = monthBounds(month);
  const sum = (where: string) =>
    (db.prepare(`SELECT COALESCE(SUM(t.amount_cents), 0) n FROM transactions t WHERE t.date BETWEEN ? AND ? AND ${COUNTED} AND ${where}`).get(from, to) as { n: number }).n;

  const allSpending = neg(sum("t.kind IN ('spend', 'fee', 'tax')"));
  const homeProjectCents = neg(sum(IN_PROJECT));
  const incomeCents = sum("t.kind = 'income'");
  const netCents = incomeCents - allSpending;

  const current = categorySpend(db, month);
  const history = [1, 2, 3, 4, 5, 6].map((k) => addMonths(month, -k)).filter((m) => months.includes(m)).map((m) => categorySpend(db, m));
  // The home project has its own screen and its own line under the headline, so the bars add up
  // to everyday spending (less tax and fees, which have no category).
  const categories: CategoryBar[] = CATEGORIES.filter((c) => c.name !== 'Home project').map((c) => ({
    name: c.name,
    slot: c.slot,
    cents: current.get(c.name) ?? 0,
    medianCents: median(history.map((h) => h.get(c.name) ?? 0)),
  }))
    .filter((c) => c.cents !== 0 || (c.medianCents ?? 0) > 0)
    .sort((a, b) => b.cents - a.cents);

  const unsorted = db
    .prepare(
      `SELECT COUNT(*) n, COALESCE(-SUM(CASE WHEN t.amount_cents < 0 THEN t.amount_cents END), 0) o,
              COALESCE(SUM(CASE WHEN t.amount_cents > 0 THEN t.amount_cents END), 0) i
       FROM transactions t WHERE t.kind = 'unclassified' AND t.date BETWEEN ? AND ? AND ${COUNTED}`,
    )
    .get(from, to) as { n: number; o: number; i: number };

  const cov = coverage(db);
  const mi = cov.months.indexOf(month);
  const missing: string[] = [];
  let unseenCents = 0;
  for (const r of cov.rows) {
    const cell = mi >= 0 ? r.cells[mi] : 'missing';
    const unseen = mi >= 0 ? r.unseenCents[mi]! : 0;
    unseenCents += unseen;
    if (r.seenOnly ? unseen > 0 : cell === 'missing') missing.push(r.account);
  }
  // Held rows are found by their own dates: a card statement for August holds late-July rows,
  // and a purchase can post into the next statement.
  const held = [
    ...new Set(
      (
        db
          .prepare(
            `SELECT DISTINCT a.bank, a.product, a.last4, a.label FROM transactions t
             JOIN statements s ON s.id = t.statement_id JOIN accounts a ON a.id = s.account_id
             WHERE t.date BETWEEN ? AND ? AND s.reconciled = 0 AND s.accepted = 0`,
          )
          .all(from, to) as { bank: string; product: string; last4: string; label: string | null }[]
      ).map((a) => accountLabel(a)),
    ),
  ];
  const partial = partialCoverage(db, cov, month);

  const cash = cashAt(db, month);
  return {
    month,
    months,
    spentCents: allSpending - homeProjectCents,
    homeProjectCents,
    taxCents: neg(sum(`t.kind = 'tax' AND NOT (${IN_PROJECT})`)),
    feesCents: neg(sum(`t.kind = 'fee' AND NOT (${IN_PROJECT})`)),
    incomeCents,
    netCents,
    savingsRate: incomeCents > 0 ? netCents / incomeCents : null,
    investedCents: neg(sum("t.kind = 'investment'")),
    partnerCents: sum("t.kind = 'partner-contribution'"),
    cashOnHandCents: cash.cents,
    cashStale: cash.stale,
    cashTrend: months.filter((m) => m <= month).map((m) => ({ month: m, cents: cashAt(db, m).cents })),
    categories,
    notSorted: { count: unsorted.n, outCents: unsorted.o, inCents: unsorted.i },
    coverage: {
      complete: missing.length === 0 && partial.length === 0 && unseenCents === 0 && held.length === 0,
      missing,
      partial,
      unseenCents,
      held,
    },
  };
}
