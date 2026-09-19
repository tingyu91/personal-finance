import type { Db } from '../db/open';
import { accountLabel } from '../core/labels';
import { slotOf } from '../classify/categories';

/** One ledger row as the UI sees it. Never carries more than the last four digits of anything. */
export interface TransactionView {
  fingerprint: string;
  date: string;
  postDate: string | null;
  payee: string;
  raw: string;
  amountCents: number;
  currency: string;
  fx: { currency: string; amountCents: number } | null;
  kind: string;
  category: string | null;
  slot: number;
  bucket: string | null;
  vendor: string | null;
  note: string | null;
  needsReview: boolean;
  manual: boolean;
  accountId: number | null;
  account: string | null;
  cardholder: string | null;
  pairFingerprint: string | null;
  targetAccount: string | null;
  held: boolean;
}

export const VIEW_SELECT = `
  SELECT t.fingerprint, t.date, t.post_date, t.payee, t.raw, t.amount_cents, t.currency, t.fx_currency, t.fx_amount_cents,
         t.kind, t.category, t.bucket, t.vendor, t.note, t.needs_review, t.manual, t.account_id, t.cardholder,
         t.pair_fingerprint,
         a.bank, a.product, a.last4, a.label, a.currency AS acct_currency,
         ta.bank AS t_bank, ta.product AS t_product, ta.last4 AS t_last4, ta.label AS t_label,
         CASE WHEN t.statement_id IS NULL THEN 0 ELSE (s.reconciled = 0 AND s.accepted = 0) END AS held
  FROM transactions t
  LEFT JOIN accounts a ON a.id = t.account_id
  LEFT JOIN accounts ta ON ta.id = t.target_account_id
  LEFT JOIN statements s ON s.id = t.statement_id`;

export interface ViewRow {
  fingerprint: string;
  date: string;
  post_date: string | null;
  payee: string;
  raw: string;
  amount_cents: number;
  currency: string;
  fx_currency: string | null;
  fx_amount_cents: number | null;
  kind: string | null;
  category: string | null;
  bucket: string | null;
  vendor: string | null;
  note: string | null;
  needs_review: number;
  manual: number;
  account_id: number | null;
  cardholder: string | null;
  pair_fingerprint: string | null;
  bank: string | null;
  product: string | null;
  last4: string | null;
  label: string | null;
  acct_currency: string | null;
  t_bank: string | null;
  t_product: string | null;
  t_last4: string | null;
  t_label: string | null;
  held: number;
}

export function toView(r: ViewRow): TransactionView {
  return {
    fingerprint: r.fingerprint,
    date: r.date,
    postDate: r.post_date,
    payee: r.payee,
    raw: r.raw,
    amountCents: r.amount_cents,
    currency: r.currency,
    fx: r.fx_currency && r.fx_amount_cents !== null ? { currency: r.fx_currency, amountCents: r.fx_amount_cents } : null,
    kind: r.kind ?? 'unclassified',
    category: r.category,
    slot: slotOf(r.category),
    bucket: r.bucket,
    vendor: r.vendor,
    note: r.note,
    needsReview: r.needs_review === 1,
    manual: r.manual === 1,
    accountId: r.account_id,
    account: r.bank !== null ? accountLabel({ bank: r.bank, product: r.product ?? '', last4: r.last4 ?? '', currency: r.acct_currency ?? 'SGD', label: r.label }) : null,
    cardholder: r.cardholder,
    pairFingerprint: r.pair_fingerprint,
    targetAccount: r.t_bank !== null ? accountLabel({ bank: r.t_bank, product: r.t_product ?? '', last4: r.t_last4 ?? '', label: r.t_label }) : null,
    held: r.held === 1,
  };
}

export function getTransaction(db: Db, fingerprint: string): TransactionView | null {
  const row = db.prepare(`${VIEW_SELECT} WHERE t.fingerprint = ?`).get(fingerprint) as ViewRow | undefined;
  return row ? toView(row) : null;
}
