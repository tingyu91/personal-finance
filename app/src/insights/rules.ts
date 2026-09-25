import type { Benchmarks, Tier } from '../benchmarks';
import { ageInDays } from '../benchmarks';
import type { Settings } from '../settings';
import { addDays, addMonths, daysBetween } from '../core/dates';
import { formatSGD } from '../core/money';

/**
 * The ten insight rules of PRD §7.5, as pure functions over a snapshot of the data. Each states
 * its evidence, links to its rows, and never recommends a product, trade or investment.
 */
export type Level = 'act' | 'watch' | 'info';

export interface InsightItem {
  /** Stable across runs while the finding is the same, so dismissing it sticks. */
  key: string;
  rule: number;
  level: Level;
  title: string;
  detail: string;
  /** Cents a year, only where the estimate is honest. */
  worthCents?: number;
  worthLabel?: string;
  per?: string;
  fingerprints: string[];
  action?: { label: string; href: string };
  /** For rules that rest on outside facts (PRD §7.5). */
  checkedOn?: string;
}

export interface SnapRow {
  fingerprint: string;
  date: string;
  accountId: number | null;
  payee: string;
  raw: string;
  amountCents: number;
  kind: string;
  category: string | null;
  bucket: string | null;
  targetAccountId: number | null;
}

export interface SnapAccount {
  id: number;
  label: string;
  kind: string;
  product: string;
  bank: string;
  seenOnly: boolean;
}

export interface SnapStatement {
  accountId: number;
  month: string;
  periodStart: string;
  periodEnd: string;
  openingCents: number;
  closingCents: number;
  meta: Record<string, number | string | null>;
  /** End-of-day balances from the rows, for an average. */
  balances: { date: string; cents: number }[];
}

export interface Snapshot {
  today: string;
  months: string[];
  rows: SnapRow[];
  accounts: SnapAccount[];
  statements: SnapStatement[];
  coverage: { months: string[]; rows: { account: string; seenOnly: boolean; cells: string[]; unseenCents: number[]; accountId: number | null }[] };
  lastImport: string | null;
  home: {
    budgetCents: number | null;
    totalCents: number;
    endMonth: string | null;
    vendors: { name: string; balanceCents: number | null }[];
    rows: { fingerprint: string; date: string }[];
  } | null;
  settings: Settings;
  benchmarks: Benchmarks;
}

const SPENDING = new Set(['spend', 'fee', 'tax']);

/** "S$60,000": whole dollars, for titles only. */
export function roundSGD(cents: number): string {
  return `S$${Math.round(Math.abs(cents) / 100).toLocaleString('en-SG')}`;
}
const txHref = (params: Record<string, string>) => `#/transactions?${new URLSearchParams(params).toString()}`;
const insightHref = (key: string) => txHref({ insight: key });

function median(ns: number[]): number | null {
  if (!ns.length) return null;
  const s = [...ns].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

function monthName(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}`;
}

/**
 * Months with a statement missing or money sent to cards and wallets Tally cannot see (coverage
 * first, CLAUDE.md rule 9). Totals that reach into these months are probably low.
 */
export function incompleteMonths(s: Snapshot): string[] {
  return s.coverage.months.filter((_, i) => s.coverage.rows.some((r) => r.cells[i] === 'missing' || (r.unseenCents[i] ?? 0) > 0));
}

/** "checked 2026-09-19", and Watch when the check is too old (PRD §7.5). */
function dated(level: Level, checkedOn: string, s: Snapshot): { level: Level; note: string } {
  const old = ageInDays(checkedOn, s.today) > s.benchmarks.thresholds.outsideFactsStaleDays;
  return { level: old && level === 'act' ? 'watch' : level, note: old ? `Last checked ${checkedOn}, over six months ago, so check it again.` : `Checked ${checkedOn}.` };
}

// 1. Unseen money --------------------------------------------------------------------------

export function unseenMoney(s: Snapshot): InsightItem[] {
  const seen = s.coverage.rows.filter((r) => r.seenOnly && r.unseenCents.some((c) => c > 0));
  if (!seen.length) return [];
  const total = seen.reduce((t, r) => t + r.unseenCents.reduce((a, b) => a + b, 0), 0);
  // Averaged over every month with statements, not only the months with unseen money.
  const months = s.coverage.months.length || 1;
  const perMonth = Math.round(total / months);
  const accountIds = new Set(seen.map((r) => r.accountId).filter((x): x is number => x !== null));
  const fingerprints = s.rows
    .filter((r) => (r.kind === 'card-repayment' && r.amountCents < 0 && r.targetAccountId !== null && accountIds.has(r.targetAccountId)) || r.kind === 'wallet-topup')
    .map((r) => r.fingerprint);
  const list = seen
    .map((r) => ({ account: r.account, cents: r.unseenCents.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.cents - a.cents)
    .map((r) => `${r.account} ${formatSGD(r.cents)}`)
    .join(', ');
  return [
    {
      key: `unseen:${s.coverage.months.at(-1)}`,
      rule: 1,
      level: perMonth >= s.benchmarks.thresholds.unseenActCentsPerMonth ? 'act' : 'watch',
      title: `${formatSGD(total)} went to cards and wallets Tally cannot see into`,
      detail: `About ${formatSGD(perMonth)} a month over ${months} ${months === 1 ? 'month' : 'months'}. ${list}. Add their statements to see what it bought.`,
      fingerprints,
      action: { label: 'See where to get the statements', href: '#/statements' },
    },
  ];
}

// 2. UOB One bonus interest missed ---------------------------------------------------------

export function tieredInterestCents(balanceCents: number, tiers: Tier[]): number {
  let left = balanceCents;
  let prev = 0;
  let yearly = 0;
  for (const t of tiers) {
    const cap = t.uptoCents === null ? Infinity : t.uptoCents - prev;
    const part = Math.max(0, Math.min(left, cap));
    yearly += (part * t.ratePct) / 100;
    left -= part;
    if (t.uptoCents !== null) prev = t.uptoCents;
    if (left <= 0) break;
  }
  return Math.round(yearly);
}

/** Average end-of-day balance over a statement period. */
export function averageBalance(st: SnapStatement): number {
  const days = daysBetween(st.periodStart, st.periodEnd) + 1;
  if (days <= 0) return st.closingCents;
  let bal = st.openingCents;
  let total = 0;
  let i = 0;
  const byDate = [...st.balances].sort((a, b) => a.date.localeCompare(b.date));
  for (let d = 0; d < days; d++) {
    const date = new Date(Date.parse(`${st.periodStart}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
    while (i < byDate.length && byDate[i]!.date <= date) bal = byDate[i++]!.cents;
    total += bal;
  }
  return Math.round(total / days);
}

export function uobOneBonus(s: Snapshot): InsightItem[] {
  const b = s.benchmarks.uobOne;
  const one = s.accounts.filter((a) => a.bank === 'UOB' && /One Account/i.test(a.product));
  const out: InsightItem[] = [];
  for (const acct of one) {
    const salaryIn = (month: string) =>
      s.rows.some((r) => r.accountId === acct.id && r.date.startsWith(month) && /\bSALA\b/i.test(r.raw) && r.amountCents >= b.minSalaryCents);
    // PRD §7.5 row 2: only months where UOB printed the eligible card spend while a salary credit
    // was present. The printed spend can be for the month before the statement's, so the salary
    // is looked for in the month the spend was for.
    const judged = s.statements
      .filter((st) => st.accountId === acct.id && 'creditCardEligibleSpendCents' in st.meta)
      .sort((a, c) => a.month.localeCompare(c.month))
      .map((st) => {
        const spendMonth = typeof st.meta.eligibleSpendMonth === 'string' ? st.meta.eligibleSpendMonth : st.month;
        const spend = Number(st.meta.creditCardEligibleSpendCents ?? 0) + Number(st.meta.debitCardEligibleSpendCents ?? 0);
        const avg = averageBalance(st);
        const potential = tieredInterestCents(avg, b.salaryTiers) - Math.round((avg * b.baseRatePct) / 100);
        return { st, spend, bonus: Number(st.meta.bonusInterestCents ?? 0), salary: salaryIn(spendMonth), monthlyWorth: Math.round(potential / 12) };
      })
      .filter((m) => m.salary);
    const missed = judged.filter((m) => m.bonus === 0 && m.spend < b.minCardSpendCents);
    if (!missed.length) continue;
    const worth = Math.round((missed.reduce((t, m) => t + m.monthlyWorth, 0) / missed.length) * 12);
    const lo = Math.min(...missed.map((m) => m.spend));
    const hi = Math.max(...missed.map((m) => m.spend));
    const d = dated(worth >= s.benchmarks.thresholds.bonusActWorthCentsPerYear ? 'act' : 'watch', b.checked_on, s);
    out.push({
      key: `uob-one:${acct.id}:${missed.at(-1)!.st.month}`,
      rule: 2,
      level: d.level,
      title: `${acct.label} paid no bonus interest in ${missed.length} of ${judged.length} months with a salary credit`,
      detail:
        `Eligible card spend was ${lo === hi ? formatSGD(lo) : `${formatSGD(lo)} to ${formatSGD(hi)}`} a month, below the ${formatSGD(b.minCardSpendCents)} UOB lists. ` +
        `At your average balance the bonus would be worth about ${formatSGD(worth)} a year. ${d.note}`,
      worthCents: worth,
      fingerprints: s.rows.filter((r) => r.accountId === acct.id && /\bSALA\b/i.test(r.raw)).map((r) => r.fingerprint),
      action: { label: 'See the account’s rows', href: txHref({ account: String(acct.id) }) },
      checkedOn: b.checked_on,
    });
  }
  return out;
}

// 3. Possible duplicate payments -----------------------------------------------------------

export function duplicates(s: Snapshot): InsightItem[] {
  const t = s.benchmarks.thresholds;
  const out: InsightItem[] = [];
  // A payee paid the same amount again and again (a cleaner, a monthly transfer) is a series,
  // not a duplicate: duplicateSeriesCount or more such payments within duplicateSeriesWindowDays
  // of the pair. One identical payment months earlier does not hide a real duplicate.
  // Refunded payments are kind "refund", so they never show here.
  const sig = (r: SnapRow) => `${r.payee.toLowerCase()}|${r.amountCents}`;
  const datesOf = new Map<string, string[]>();
  for (const r of s.rows) if (r.amountCents < 0) datesOf.set(sig(r), [...(datesOf.get(sig(r)) ?? []), r.date]);
  const isSeries = (a: SnapRow, c: SnapRow) => {
    const from = addDays(a.date, -t.duplicateSeriesWindowDays);
    const to = addDays(c.date, t.duplicateSeriesWindowDays);
    return (datesOf.get(sig(a)) ?? []).filter((d) => d >= from && d <= to).length >= t.duplicateSeriesCount;
  };
  const candidates = s.rows
    .filter((r) => r.amountCents <= -t.duplicateMinCents && (SPENDING.has(r.kind) || r.kind === 'unclassified'))
    .sort((a, b) => a.date.localeCompare(b.date));
  const used = new Set<string>();
  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i]!;
    if (used.has(a.fingerprint)) continue;
    for (let j = i + 1; j < candidates.length; j++) {
      const c = candidates[j]!;
      if (daysBetween(a.date, c.date) > t.duplicateDays) break;
      if (used.has(c.fingerprint) || c.amountCents !== a.amountCents || c.payee.toLowerCase() !== a.payee.toLowerCase()) continue;
      if (isSeries(a, c)) break;
      used.add(a.fingerprint).add(c.fingerprint);
      const key = `dup:${[a.fingerprint, c.fingerprint].sort().join('|')}`;
      out.push({
        key,
        rule: 3,
        level: 'watch',
        title: `Two payments of ${formatSGD(-a.amountCents)} to ${a.payee}, ${daysBetween(a.date, c.date)} days apart`,
        detail: `On ${a.date} and ${c.date}. If only one was meant, the other is worth asking about.`,
        worthCents: -a.amountCents,
        worthLabel: 'Amount',
        per: 'once',
        fingerprints: [a.fingerprint, c.fingerprint],
        action: { label: 'See both payments', href: insightHref(key) },
      });
      break;
    }
  }
  return out;
}

// 4. Fees ----------------------------------------------------------------------------------

// Not "DR CO CHARGES": on DBS that line is the cashier's order itself, not a fee for it.
const FEE_TEXT = /ANNUAL FEE|MEMBERSHIP FEE|LATE (PAYMENT )?(FEE|CHARGE)|FINANCE CHARGE|INTEREST CHARGE|FOREIGN (CURRENCY )?TRANSACTION FEE|FX FEE|CROSS.?BORDER|SERVICE CHARGE|TT CHARGES|CABLE CHARGE|FALL.?BELOW FEE|DEBIT CARD FEE/i;

export function fees(s: Snapshot): InsightItem[] {
  const rows = s.rows.filter((r) => r.amountCents < 0 && (r.kind === 'fee' || (FEE_TEXT.test(r.raw) && (SPENDING.has(r.kind) || r.kind === 'unclassified'))));
  if (!rows.length) return [];
  const total = rows.reduce((t, r) => t - r.amountCents, 0);
  const months = new Set(s.months).size || 1;
  const yearly = Math.round((total / months) * 12);
  const kinds = [...new Set(rows.map((r) => r.payee))].slice(0, 4).join(', ');
  const key = `fees:${s.months.at(-1)}`;
  return [
    {
      key,
      rule: 4,
      level: 'watch',
      title: `${formatSGD(total)} in bank and card fees across ${months} ${months === 1 ? 'month' : 'months'}`,
      detail: `${rows.length} ${rows.length === 1 ? 'charge' : 'charges'}: ${kinds}. Banks often waive a card's annual fee when asked.`,
      worthCents: yearly,
      worthLabel: 'About',
      per: 'a year at this rate',
      fingerprints: rows.map((r) => r.fingerprint),
      action: { label: 'See the fees', href: insightHref(key) },
    },
  ];
}

// 5. Subscriptions -------------------------------------------------------------------------

export function subscriptions(s: Snapshot): InsightItem[] {
  const t = s.benchmarks.thresholds;
  const byPayee = new Map<string, SnapRow[]>();
  for (const r of s.rows) {
    // Bills for the home (property tax, the condo fund) repeat too, but they are not subscriptions.
    if (r.kind !== 'spend' || r.amountCents >= 0 || r.bucket || r.category === 'Home running' || r.category === 'Home project') continue;
    const k = r.payee.toLowerCase();
    if (!byPayee.has(k)) byPayee.set(k, []);
    byPayee.get(k)!.push(r);
  }
  const subs: { payee: string; monthly: number; rows: SnapRow[]; isNew: boolean; changed: boolean }[] = [];
  const last = s.months.at(-1) ?? s.today.slice(0, 7);
  for (const rows of byPayee.values()) {
    const perMonth = new Map<string, SnapRow>();
    for (const r of rows) if (!perMonth.has(r.date.slice(0, 7))) perMonth.set(r.date.slice(0, 7), r);
    const months = [...perMonth.keys()].sort();
    // A run of consecutive months with similar amounts on a similar day.
    let run: string[] = [];
    for (const m of months) {
      if (run.length && addMonths(run.at(-1)!, 1) !== m) run = [];
      run.push(m);
    }
    if (run.length < t.subscriptionMonths) continue;
    const amounts = run.map((m) => -perMonth.get(m)!.amountCents);
    const ref = median(amounts)!;
    const similar = amounts.filter((a) => Math.abs(a - ref) <= (ref * t.subscriptionAmountTolerancePct) / 100).length >= run.length - 1;
    if (!similar || run.at(-1)! < addMonths(last, -1)) continue;
    const latest = amounts.at(-1)!;
    subs.push({
      payee: rows[0]!.payee,
      monthly: latest,
      rows: run.map((m) => perMonth.get(m)!),
      isNew: run[0]! >= addMonths(last, -(t.subscriptionMonths - 1)),
      changed: amounts.length > 1 && Math.abs(latest - amounts.at(-2)!) > (amounts.at(-2)! * t.subscriptionAmountTolerancePct) / 100,
    });
  }
  if (!subs.length) return [];
  const monthly = subs.reduce((t2, x) => t2 + x.monthly, 0);
  const notes = [
    ...subs.filter((x) => x.isNew).map((x) => `${x.payee} is new`),
    ...subs.filter((x) => x.changed).map((x) => `${x.payee} changed price`),
  ];
  const key = `subs:${subs.map((x) => x.payee.toLowerCase()).sort().join('|')}`;
  return [
    {
      key,
      rule: 5,
      level: 'info',
      title: `${subs.length} regular monthly ${subs.length === 1 ? 'charge' : 'charges'}, about ${formatSGD(monthly)} a month`,
      detail: `${subs.map((x) => `${x.payee} ${formatSGD(x.monthly)}`).join(', ')}.${notes.length ? ` ${notes.join('; ')}.` : ''}`,
      worthCents: monthly * 12,
      worthLabel: 'About',
      per: 'a year',
      fingerprints: subs.flatMap((x) => x.rows.map((r) => r.fingerprint)),
      action: { label: 'See the charges', href: insightHref(key) },
    },
  ];
}

// 6. Spending spike ------------------------------------------------------------------------

export function spendingSpike(s: Snapshot): InsightItem[] {
  const month = s.months.at(-1);
  if (!month) return [];
  const t = s.benchmarks.thresholds;
  const spendOf = (m: string, cat: string) =>
    s.rows
      .filter((r) => r.kind === 'spend' && r.category === cat && !r.bucket && r.date.startsWith(m))
      .reduce((a, r) => a - r.amountCents, 0);
  const cats = [...new Set(s.rows.filter((r) => r.kind === 'spend' && r.category && r.category !== 'Home project').map((r) => r.category!))];
  const gaps = new Set(incompleteMonths(s));
  const out: InsightItem[] = [];
  for (const cat of cats) {
    const history = [1, 2, 3, 4, 5, 6].map((k) => addMonths(month, -k)).filter((m) => s.months.includes(m));
    if (history.length < 3) continue;
    const med = median(history.map((m) => spendOf(m, cat)))!;
    const now = spendOf(month, cat);
    if (med <= 0 || now < med * t.spikeRatio) continue;
    const key = `spike:${cat}:${month}`;
    out.push({
      key,
      rule: 6,
      level: 'watch',
      title: `${cat} was ${formatSGD(now)} in ${monthName(month)}, ${(now / med).toFixed(1)} times the usual`,
      detail:
        `The median of the ${history.length} months before was ${formatSGD(med)}.` +
        ([month, ...history].some((m) => gaps.has(m)) ? ' Some of these months have statements missing or money Tally cannot see, so both figures may be low.' : ''),
      fingerprints: s.rows.filter((r) => r.kind === 'spend' && r.category === cat && !r.bucket && r.date.startsWith(month)).map((r) => r.fingerprint),
      action: { label: `See ${cat} in ${monthName(month)}`, href: txHref({ month, category: cat }) },
    });
  }
  return out;
}

// 7. Idle cash -----------------------------------------------------------------------------

export function idleCash(s: Snapshot): InsightItem[] {
  const month = s.months.at(-1);
  if (!month) return [];
  const deposits = s.accounts.filter((a) => a.kind === 'deposit' && !a.seenOnly);
  const cash = deposits.reduce((t, a) => {
    const st = s.statements.filter((x) => x.accountId === a.id && x.month <= month).sort((x, y) => y.month.localeCompare(x.month))[0];
    return t + (st?.closingCents ?? 0);
  }, 0);
  const recent = [0, 1, 2, 3, 4, 5].map((k) => addMonths(month, -k)).filter((m) => s.months.includes(m));
  const monthlySpend = Math.round(
    recent.reduce((t, m) => t + s.rows.filter((r) => SPENDING.has(r.kind) && !r.bucket && r.category !== 'Home project' && r.date.startsWith(m)).reduce((a, r) => a - r.amountCents, 0), 0) /
      Math.max(1, recent.length),
  );
  if (monthlySpend <= 0) return [];
  const buffer = monthlySpend * s.settings.idleCashMonths;
  if (cash <= buffer) return [];
  const interest = s.rows.filter((r) => r.kind === 'income' && r.category === 'Interest').reduce((t, r) => t + r.amountCents, 0);
  return [
    {
      key: `idle:${month}`,
      rule: 7,
      level: 'info',
      title: `${formatSGD(cash - buffer)} sits above ${s.settings.idleCashMonths} months of spending`,
      detail: `Bank balances were ${formatSGD(cash)} at the end of ${monthName(month)}, against about ${formatSGD(monthlySpend)} of everyday spending a month. Interest across these statements came to ${formatSGD(interest)}. This is a fact, not advice.`,
      fingerprints: s.rows.filter((r) => r.kind === 'income' && r.category === 'Interest').map((r) => r.fingerprint),
    },
  ];
}

// 8. Tax-year moves ------------------------------------------------------------------------

export function taxYear(s: Snapshot): InsightItem[] {
  const [y, m] = s.today.split('-').map(Number) as [number, number];
  if (m < 10 || !s.months.some((x) => x.startsWith(String(y)))) return [];
  const { srs, cpfTopUp } = s.benchmarks;
  const srsPaid = s.rows.filter((r) => r.date.startsWith(String(y)) && /\bSRS\b/i.test(r.raw) && r.amountCents < 0).reduce((t, r) => t - r.amountCents, 0);
  const cpfPaid = s.rows.filter((r) => r.date.startsWith(String(y)) && /CPF.*(TOP.?UP|RSTU)|RSTU/i.test(r.raw) && r.amountCents < 0).reduce((t, r) => t - r.amountCents, 0);
  const srsRoom = Math.max(0, srs.capCitizenCents - srsPaid);
  const cpfRoom = Math.max(0, cpfTopUp.selfCapCents - cpfPaid);
  if (!srsRoom && !cpfRoom) return [];
  const rate = s.settings.marginalTaxRate;
  const worth = rate === null ? undefined : Math.round((srsRoom + cpfRoom) * rate);
  const checked = srs.checked_on < cpfTopUp.checked_on ? srs.checked_on : cpfTopUp.checked_on;
  const d = dated(m >= 11 ? 'act' : 'info', checked, s);
  return [
    {
      key: `tax:${y}`,
      rule: 8,
      level: d.level,
      title: `Tax relief for ${y} closes on 31 December`,
      detail:
        `SRS contributions up to ${formatSGD(srs.capCitizenCents)} (${formatSGD(srsPaid)} seen this year) and CPF cash top-ups to your own account up to ${formatSGD(cpfTopUp.selfCapCents)} (${formatSGD(cpfPaid)} seen) reduce next year's tax. ` +
        (rate === null ? 'Set your marginal tax rate in settings.json to see what the relief is worth. ' : `At your ${Math.round(rate * 1000) / 10}% marginal rate, the unused room is worth about ${formatSGD(worth!)} in tax. `) +
        d.note,
      worthCents: worth,
      worthLabel: 'Tax relief worth about',
      per: `for ${y}`,
      fingerprints: [],
      checkedOn: checked,
    },
  ];
}

// 9. Home project --------------------------------------------------------------------------

export function homeProjectWatch(s: Snapshot): InsightItem[] {
  const h = s.home;
  if (!h) return [];
  const out: InsightItem[] = [];
  const owed = h.vendors.filter((v) => (v.balanceCents ?? 0) > 0);
  if (owed.length) {
    const total = owed.reduce((t, v) => t + v.balanceCents!, 0);
    out.push({
      key: `home-balance:${owed.map((v) => `${v.name}=${v.balanceCents}`).join('|')}`,
      rule: 9,
      level: 'info',
      title: `${formatSGD(total)} is still to pay on home contracts`,
      detail: owed.map((v) => `${v.name} ${formatSGD(v.balanceCents!)}`).join(', ') + '.',
      fingerprints: [],
      action: { label: 'See the vendors', href: '#/home-project' },
    });
  }
  if (h.budgetCents && h.totalCents >= h.budgetCents * s.benchmarks.thresholds.budgetWatchRatio) {
    out.push({
      key: `home-budget:${Math.floor((h.totalCents / h.budgetCents) * 10)}`,
      rule: 9,
      level: 'info',
      title: `The home has used ${Math.round((h.totalCents / h.budgetCents) * 100)}% of its ${roundSGD(h.budgetCents)} budget`,
      detail: h.totalCents > h.budgetCents ? `${formatSGD(h.totalCents - h.budgetCents)} over.` : `${formatSGD(h.budgetCents - h.totalCents)} left.`,
      fingerprints: [],
      action: { label: 'See the home project', href: '#/home-project' },
    });
  }
  if (h.endMonth) {
    const after = h.rows.filter((r) => r.date.slice(0, 7) > h.endMonth!);
    if (after.length) {
      const key = `home-after:${h.endMonth}:${after.length}`;
      out.push({
        key,
        rule: 9,
        level: 'info',
        title: `${after.length} home ${after.length === 1 ? 'payment' : 'payments'} after the project ended`,
        detail: `The project ended in ${monthName(h.endMonth)}. Late payments are often snagging or retention sums; check they were due.`,
        fingerprints: after.map((r) => r.fingerprint),
        action: { label: 'See them', href: insightHref(key) },
      });
    }
  }
  return out;
}

// 10. Stale data ---------------------------------------------------------------------------

export function staleData(s: Snapshot): InsightItem[] {
  const out: InsightItem[] = [];
  if (s.lastImport && daysBetween(s.lastImport, s.today) >= s.benchmarks.thresholds.staleDays) {
    out.push({
      key: `stale-import:${s.lastImport}`,
      rule: 10,
      level: 'watch',
      title: `Nothing imported for ${daysBetween(s.lastImport, s.today)} days`,
      detail: `The last import was on ${s.lastImport}. New statements usually arrive in the first week of the month.`,
      fingerprints: [],
      action: { label: 'Import statements', href: '#/statements' },
    });
  }
  const gaps = s.coverage.rows.filter((r) => !r.seenOnly && r.cells.includes('missing') && r.cells.includes('ok'));
  for (const r of gaps) {
    const first = r.cells.indexOf('ok');
    const missing = s.coverage.months.filter((_, i) => i > first && r.cells[i] === 'missing');
    if (!missing.length) continue;
    out.push({
      // Keyed by where the gap starts, so dismissing a closed account's gap sticks as months pass.
      key: `stale-gap:${r.account}:${missing[0]}`,
      rule: 10,
      level: 'watch',
      title: `${r.account} has no statement for ${missing.length === 1 ? monthName(missing[0]!) : `${missing.length} months`}`,
      detail: `Missing: ${missing.map(monthName).join(', ')}. Totals for those months leave out this account.`,
      fingerprints: [],
      action: { label: 'See coverage', href: '#/statements' },
    });
  }
  return out;
}

export const RULES = [unseenMoney, uobOneBonus, duplicates, fees, subscriptions, spendingSpike, idleCash, taxYear, homeProjectWatch, staleData];

const ORDER: Record<Level, number> = { act: 0, watch: 1, info: 2 };

export function runRules(s: Snapshot): InsightItem[] {
  return RULES.flatMap((r) => r(s)).sort((a, b) => ORDER[a.level] - ORDER[b.level] || (b.worthCents ?? 0) - (a.worthCents ?? 0) || a.rule - b.rule);
}
