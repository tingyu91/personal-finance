import type { Db } from '../db/open';
import { accountLabel } from '../core/labels';
import { COUNTED, dataMonths } from './months';

export type Cell = 'ok' | 'missing' | 'na';

export interface CoverageRow {
  /** Null for a wallet known only from top-ups. */
  accountId: number | null;
  account: string;
  kind: string;
  seenOnly: boolean;
  cells: Cell[];
  /** Per month: money that went to this account where Tally cannot see what it bought. */
  unseenCents: number[];
}

const WALLETS: [RegExp, string][] = [
  [/PAYLAH/i, 'DBS PayLah'],
  [/WISE ASIA-PACIFIC|\bWISE\b/i, 'Wise'],
  [/YOUTRIP/i, 'YouTrip'],
  [/GRABPAY/i, 'GrabPay'],
  [/REVOLUT/i, 'Revolut'],
];

export function walletName(raw: string): string {
  return WALLETS.find(([re]) => re.test(raw))?.[1] ?? 'Wallet';
}

/**
 * Which account × month statements Tally has (PRD §4.7). A card is also covered in a month when
 * the combined statement file it comes in was imported and simply did not list it (no activity);
 * before the card first appears, those months are "not open". Accounts seen only as repayment
 * targets, and wallets seen only from top-ups, are missing in every month.
 */
export function coverage(db: Db): { months: string[]; rows: CoverageRow[] } {
  const months = dataMonths(db);
  const index = new Map(months.map((m, i) => [m, i]));
  const accounts = db
    .prepare("SELECT id, bank, product, last4, label, kind, seen_only_as_target, currency FROM accounts WHERE currency = 'SGD' ORDER BY seen_only_as_target, kind DESC, bank, product")
    .all() as { id: number; bank: string; product: string; last4: string; label: string | null; kind: string; seen_only_as_target: number; currency: string }[];
  const statements = db
    .prepare('SELECT st.account_id, st.month, f.adapter_id FROM statements st JOIN files f ON f.id = st.file_id')
    .all() as { account_id: number; month: string; adapter_id: string }[];
  const fileMonths = new Map<string, Set<string>>();
  for (const f of db.prepare('SELECT adapter_id, month FROM files').all() as { adapter_id: string; month: string }[]) {
    if (!fileMonths.has(f.adapter_id)) fileMonths.set(f.adapter_id, new Set());
    fileMonths.get(f.adapter_id)!.add(f.month);
  }

  const rows: CoverageRow[] = [];
  for (const a of accounts) {
    const own = statements.filter((s) => s.account_id === a.id);
    const have = new Set(own.map((s) => s.month));
    const first = own.map((s) => s.month).sort()[0];
    const adapters = new Set(own.map((s) => s.adapter_id));
    const cells: Cell[] = months.map((m) => {
      if (a.seen_only_as_target) return 'missing';
      if (have.has(m)) return 'ok';
      if (a.kind === 'card' && [...adapters].some((ad) => fileMonths.get(ad)?.has(m))) return first && m < first ? 'na' : 'ok';
      return 'missing';
    });
    const unseen = months.map(() => 0);
    if (a.seen_only_as_target) {
      const repaid = db
        .prepare(
          `SELECT substr(t.date, 1, 7) m, -SUM(t.amount_cents) c FROM transactions t
           WHERE t.target_account_id = ? AND t.kind = 'card-repayment' AND t.amount_cents < 0 AND ${COUNTED} GROUP BY m`,
        )
        .all(a.id) as { m: string; c: number }[];
      for (const r of repaid) if (index.has(r.m)) unseen[index.get(r.m)!] = r.c;
    }
    rows.push({ accountId: a.id, account: accountLabel(a), kind: a.kind, seenOnly: a.seen_only_as_target === 1, cells, unseenCents: unseen });
  }

  // Wallets appear only as top-ups; what they paid for is never on a bank statement. Money the
  // wallet sends back to the bank ("MAXED OUT FROM PAYLAH") was never spent, so it nets off.
  const topups = db
    .prepare(
      `SELECT substr(t.date, 1, 7) m, t.raw, t.amount_cents FROM transactions t
       WHERE (t.kind = 'wallet-topup' OR (t.kind = 'transfer' AND t.classified_by = 'wallet')) AND ${COUNTED}`,
    )
    .all() as { m: string; raw: string; amount_cents: number }[];
  const wallets = new Map<string, number[]>();
  for (const t of topups) {
    const name = walletName(t.raw);
    if (!wallets.has(name)) wallets.set(name, months.map(() => 0));
    const i = index.get(t.m);
    if (i !== undefined) wallets.get(name)![i]! -= t.amount_cents;
  }
  for (const [name, net] of wallets) {
    // A month where more came back than went in has nothing unseen, not a negative amount.
    const unseen = net.map((c) => Math.max(0, c));
    rows.push({ accountId: null, account: name, kind: 'wallet', seenOnly: true, cells: months.map(() => 'missing'), unseenCents: unseen });
  }
  return { months, rows };
}
