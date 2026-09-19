import type { Paths } from '../config';
import type { Db } from '../db/open';
import { loadBenchmarks } from '../benchmarks';
import { accountLabel } from '../core/labels';
import { sgtDate } from '../core/dates';
import { coverage } from '../reports/coverage';
import { dataMonths, COUNTED } from '../reports/months';
import { homeProject } from '../reports/home';
import { loadSettings } from '../settings';
import type { Snapshot, SnapRow, SnapStatement } from './rules';

/** Reads everything the insight rules look at, once, into plain data. Only rows that count. */
export function snapshot(db: Db, paths: Paths, today = sgtDate(new Date().toISOString())): Snapshot {
  const settings = loadSettings(paths);
  const benchmarks = loadBenchmarks(paths);

  const rows = (
    db
      .prepare(
        `SELECT t.fingerprint, t.date, t.account_id, t.payee, t.raw, t.amount_cents, t.kind, t.category, t.bucket, t.target_account_id
         FROM transactions t WHERE ${COUNTED} ORDER BY t.date, t.id`,
      )
      .all() as {
      fingerprint: string;
      date: string;
      account_id: number | null;
      payee: string;
      raw: string;
      amount_cents: number;
      kind: string | null;
      category: string | null;
      bucket: string | null;
      target_account_id: number | null;
    }[]
  ).map(
    (r): SnapRow => ({
      fingerprint: r.fingerprint,
      date: r.date,
      accountId: r.account_id,
      payee: r.payee,
      raw: r.raw,
      amountCents: r.amount_cents,
      kind: r.kind ?? 'unclassified',
      category: r.category,
      bucket: r.bucket,
      targetAccountId: r.target_account_id,
    }),
  );

  const accounts = (
    db.prepare('SELECT id, bank, product, last4, label, kind, seen_only_as_target FROM accounts').all() as {
      id: number;
      bank: string;
      product: string;
      last4: string;
      label: string | null;
      kind: string;
      seen_only_as_target: number;
    }[]
  ).map((a) => ({ id: a.id, label: accountLabel(a), kind: a.kind, product: a.product, bank: a.bank, seenOnly: a.seen_only_as_target === 1 }));

  // Statements that count, with their printed meta and each day's last balance.
  const stRows = db
    .prepare(
      `SELECT s.id, s.account_id, s.month, s.period_start, s.period_end, s.opening_cents, s.closing_cents, s.meta_json FROM statements s
       JOIN accounts a ON a.id = s.account_id
       WHERE a.currency = 'SGD' AND (s.reconciled = 1 OR s.accepted = 1)`,
    )
    .all() as { id: number; account_id: number; month: string; period_start: string; period_end: string; opening_cents: number; closing_cents: number; meta_json: string | null }[];
  const balancesOf = db.prepare('SELECT date, balance_cents FROM transactions WHERE statement_id = ? AND balance_cents IS NOT NULL ORDER BY date, seq');
  const statements = stRows.map((s): SnapStatement => {
    const byDay = new Map<string, number>();
    for (const b of balancesOf.all(s.id) as { date: string; balance_cents: number }[]) byDay.set(b.date, b.balance_cents);
    return {
      accountId: s.account_id,
      month: s.month,
      periodStart: s.period_start,
      periodEnd: s.period_end,
      openingCents: s.opening_cents,
      closingCents: s.closing_cents,
      meta: s.meta_json ? (JSON.parse(s.meta_json) as Record<string, number | string | null>) : {},
      balances: [...byDay].map(([date, cents]) => ({ date, cents })),
    };
  });

  const cov = coverage(db);
  const last = db.prepare('SELECT MAX(imported_at) t FROM files').get() as { t: string | null };
  const h = rows.length ? homeProject(db, settings, { largeUnsortedCents: benchmarks.thresholds.largeUnsortedCents }) : null;

  return {
    today,
    months: dataMonths(db, today),
    rows,
    accounts,
    statements,
    coverage: { months: cov.months, rows: cov.rows.map((r) => ({ account: r.account, accountId: r.accountId, seenOnly: r.seenOnly, cells: r.cells, unseenCents: r.unseenCents })) },
    lastImport: last.t ? sgtDate(last.t) : null,
    home: h && h.rows.length
      ? {
          budgetCents: h.project.budgetCents,
          totalCents: h.totalCents,
          endMonth: h.project.endMonth,
          vendors: h.vendors.map((v) => ({ name: v.name, balanceCents: v.balanceCents })),
          rows: h.rows.map((r) => ({ fingerprint: r.fingerprint, date: r.date })),
        }
      : null,
    settings,
    benchmarks,
  };
}
