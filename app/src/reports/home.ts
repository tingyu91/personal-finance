import type { Db } from '../db/open';
import type { Settings } from '../settings';
import { accountLabel } from '../core/labels';
import { matchesAlias, sharesWord } from '../classify/text';
import { coverage } from './coverage';
import { COUNTED, IN_PROJECT, monthRange } from './months';
import { getProject, type Project } from '../home';
import { SEED_RULES } from '../classify/seeds';

/** Purpose lines that sound like the home: the seeded home merchants, or words a renovation uses. */
const HOME_SEEDS = SEED_RULES.filter((s) => s.bucket).map((s) => s.test);
const HOME_WORDS =
  /\b(RENO|RENOVATION|HOME|HOUSE|FURNI\w*|SOFA|DINING|KITCHEN|TAPS?|LIGHT\w*|LUMIN\w*|LAMPS?|DEPOSIT|CARPENT\w*|CURTAINS?|BLINDS?|APPLIANCES?|HANDLES?|TILES?|PAINT\w*|FRIDGE|WASHER|AIRCON|MATTRESS|WARDROBE)\b/i;

export type Payer = 'me' | 'joint' | 'partner';

export interface HomeRow {
  fingerprint: string;
  date: string;
  payee: string;
  vendor: string;
  vendorId: number | null;
  bucket: string | null;
  payer: Payer;
  account: string;
  /** Positive: money spent on the home. A refund inside the project is negative. */
  cents: number;
  note: string | null;
  raw: string;
}

export interface HomeData {
  project: Project;
  partnerName: string;
  payerLabels: Record<Payer, string>;
  totalCents: number;
  buckets: { bucket: string | null; cents: number; count: number }[];
  vendors: { id: number | null; name: string; match: string | null; contractCents: number | null; paidCents: number; balanceCents: number | null; lastPaid: string | null; count: number }[];
  payers: { payer: Payer; label: string; cents: number }[];
  /** Every partner contribution during the project; homeLike marks the ones whose purpose sounds like the home. */
  contributions: { fingerprint: string; date: string; purpose: string; cents: number; account: string; suggestedVendor: string | null; homeLike: boolean }[];
  contributionsCents: number;
  homeLikeContributionsCents: number;
  cumulative: { month: string; cents: number }[];
  unseen: { cents: number; accounts: { account: string; cents: number }[] };
  unsortedLarge: { count: number; cents: number };
  rows: HomeRow[];
}

export const BUCKET_ORDER = ['purchase', 'renovation', 'furnishing', 'running'] as const;

export const PAYER_LABELS = (partnerName: string): Record<Payer, string> => ({ me: 'You', joint: 'Joint account', partner: `${partnerName}’s cards` });

type Raw = {
  fingerprint: string;
  date: string;
  payee: string;
  vendor: string | null;
  bucket: string | null;
  amount_cents: number;
  note: string | null;
  raw: string;
  cardholder: string | null;
  owner: string | null;
  bank: string | null;
  product: string | null;
  last4: string | null;
  label: string | null;
  manual: number;
};

/**
 * Everything the Home project screen shows, from one query of the rows that belong to the
 * project (PRD §7.4 screen 3). The total is always the sum of `rows`.
 */
export function homeProject(db: Db, settings: Settings, opts: { largeUnsortedCents: number }): HomeData {
  const project = getProject(db);
  const vendors = db.prepare('SELECT id, name, match, contract_cents FROM vendors WHERE project_id = ? ORDER BY id').all(project.id ?? -1) as {
    id: number;
    name: string;
    match: string;
    contract_cents: number | null;
  }[];
  const partnerName = settings.partner.name;

  const raws = db
    .prepare(
      `SELECT t.fingerprint, t.date, t.payee, t.vendor, t.bucket, t.amount_cents, t.note, t.raw, t.cardholder, t.manual,
              a.owner, a.bank, a.product, a.last4, a.label
       FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id
       WHERE ${IN_PROJECT} AND ${COUNTED}
       ORDER BY t.date, t.id`,
    )
    .all() as Raw[];

  // A row's vendor: the one you set on it, else a vendor named exactly like its payee, else the
  // vendor whose match text is longest among those that hit (the most specific), else its payee.
  const byName = (name: string) => vendors.find((v) => v.name.toLowerCase() === name.toLowerCase());
  const vendorFor = (r: Raw): { id: number | null; name: string } => {
    if (r.vendor) {
      const named = byName(r.vendor);
      return { id: named?.id ?? null, name: named?.name ?? r.vendor };
    }
    const same = byName(r.payee);
    if (same) return { id: same.id, name: same.name };
    const payee = r.payee.toLowerCase();
    const raw = r.raw.toLowerCase();
    const hit = vendors
      .filter((v) => {
        const m = v.match.toLowerCase();
        return m && (payee.includes(m) || raw.includes(m));
      })
      .sort((a, b) => b.match.length - a.match.length || a.id - b.id)[0];
    return hit ? { id: hit.id, name: hit.name } : { id: null, name: r.payee };
  };
  const payerOf = (r: Raw): Payer => {
    if (r.cardholder && matchesAlias(r.cardholder, settings.partner.aliases)) return 'partner';
    if (r.owner === 'partner') return 'partner';
    if (r.owner === 'joint') return 'joint';
    return 'me';
  };

  const rows: HomeRow[] = raws.map((r) => {
    const v = vendorFor(r);
    return {
      fingerprint: r.fingerprint,
      date: r.date,
      payee: r.payee,
      vendor: v.name,
      vendorId: v.id,
      bucket: r.bucket,
      payer: payerOf(r),
      account: r.bank ? accountLabel({ bank: r.bank, product: r.product ?? '', last4: r.last4 ?? '', label: r.label }) : 'Manual entry',
      cents: -r.amount_cents,
      note: r.note,
      raw: r.raw,
    };
  });

  const totalCents = rows.reduce((t, r) => t + r.cents, 0);

  const bucketMap = new Map<string | null, { cents: number; count: number }>();
  for (const r of rows) {
    const b = bucketMap.get(r.bucket) ?? { cents: 0, count: 0 };
    b.cents += r.cents;
    b.count++;
    bucketMap.set(r.bucket, b);
  }
  // Known buckets in their fixed order, then any other bucket, then the rows that need one.
  const order: (string | null)[] = [...BUCKET_ORDER, ...[...bucketMap.keys()].filter((b): b is string => b !== null && !(BUCKET_ORDER as readonly string[]).includes(b)), null];
  const buckets = order.filter((b) => bucketMap.has(b)).map((b) => ({ bucket: b, ...bucketMap.get(b)! }));

  const vendorMap = new Map<string, HomeData['vendors'][number]>();
  for (const v of vendors) {
    vendorMap.set(`id:${v.id}`, { id: v.id, name: v.name, match: v.match, contractCents: v.contract_cents, paidCents: 0, balanceCents: null, lastPaid: null, count: 0 });
  }
  for (const r of rows) {
    const key = r.vendorId !== null ? `id:${r.vendorId}` : `name:${r.vendor.toLowerCase()}`;
    const v = vendorMap.get(key) ?? { id: null, name: r.vendor, match: null, contractCents: null, paidCents: 0, balanceCents: null, lastPaid: null, count: 0 };
    v.paidCents += r.cents;
    v.count++;
    if (!v.lastPaid || r.date > v.lastPaid) v.lastPaid = r.date;
    vendorMap.set(key, v);
  }
  const vendorRows = [...vendorMap.values()]
    .map((v) => ({ ...v, balanceCents: v.contractCents === null ? null : v.contractCents - v.paidCents }))
    .sort((a, b) => b.paidCents - a.paidCents || a.name.localeCompare(b.name));

  const payerLabels = PAYER_LABELS(partnerName);
  const payers = (['me', 'joint', 'partner'] as Payer[])
    .map((p) => ({ payer: p, label: payerLabels[p], cents: rows.filter((r) => r.payer === p).reduce((t, r) => t + r.cents, 0) }))
    .filter((p) => p.cents !== 0);

  const from = `${project.startMonth}-01`;
  const to = project.endMonth ? `${project.endMonth}-31` : '9999-12-31';
  const contribRaw = db
    .prepare(
      `SELECT t.fingerprint, t.date, t.payee, t.amount_cents, a.bank, a.product, a.last4, a.label FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       WHERE t.kind = 'partner-contribution' AND t.date BETWEEN ? AND ? AND ${COUNTED} ORDER BY t.date`,
    )
    .all(from, to) as { fingerprint: string; date: string; payee: string; amount_cents: number; bank: string; product: string; last4: string; label: string | null }[];
  const contributions = contribRaw.map((c) => {
    const v = vendors.find((x) => sharesWord(c.payee, x.name) || sharesWord(c.payee, x.match));
    return {
      fingerprint: c.fingerprint,
      date: c.date,
      purpose: c.payee,
      cents: c.amount_cents,
      account: accountLabel(c),
      suggestedVendor: v?.name ?? null,
      homeLike: !!v || HOME_WORDS.test(c.payee) || HOME_SEEDS.some((re) => re.test(c.payee)),
    };
  });

  // Every home row counts, whatever its date, so the line runs from the earlier of the start
  // and the first row to the last row, and always ends at the total.
  const firstMonth = [project.startMonth, rows[0]?.date.slice(0, 7)].filter((m): m is string => !!m).sort()[0]!;
  const months = monthRange(firstMonth, [firstMonth, rows.at(-1)?.date.slice(0, 7)].filter((m): m is string => !!m).sort().at(-1)!);
  let running = 0;
  const cumulative = months.map((m) => {
    running += rows.filter((r) => r.date.startsWith(m)).reduce((t, r) => t + r.cents, 0);
    return { month: m, cents: running };
  });

  const cov = coverage(db);
  const fromIdx = cov.months.findIndex((m) => m >= project.startMonth);
  let toIdx = cov.months.length - 1;
  if (project.endMonth) while (toIdx >= 0 && cov.months[toIdx]! > project.endMonth) toIdx--;
  const unseenAccounts = cov.rows
    .map((r) => ({ account: r.account, cents: fromIdx < 0 ? 0 : r.unseenCents.slice(fromIdx, toIdx + 1).reduce((t, c) => t + c, 0) }))
    .filter((r) => r.cents > 0)
    .sort((a, b) => b.cents - a.cents);

  const large = db
    .prepare(
      `SELECT COUNT(*) n, COALESCE(-SUM(t.amount_cents), 0) c FROM transactions t
       WHERE t.kind = 'unclassified' AND t.amount_cents <= ? AND t.date BETWEEN ? AND ? AND ${COUNTED}`,
    )
    .get(-opts.largeUnsortedCents, from, to) as { n: number; c: number };

  return {
    project,
    partnerName,
    payerLabels,
    totalCents,
    buckets,
    vendors: vendorRows,
    payers,
    contributions,
    contributionsCents: contributions.reduce((t, c) => t + c.cents, 0),
    homeLikeContributionsCents: contributions.filter((c) => c.homeLike).reduce((t, c) => t + c.cents, 0),
    cumulative,
    unseen: { cents: unseenAccounts.reduce((t, a) => t + a.cents, 0), accounts: unseenAccounts },
    unsortedLarge: { count: large.n, cents: large.c },
    rows,
  };
}
