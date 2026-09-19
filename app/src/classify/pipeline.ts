import type { AccountKind, Owner } from '../adapters/types';
import { daysBetween } from '../core/dates';
import { normaliseRaw } from '../core/fingerprint';
import type { Settings } from '../settings';
import { cardTarget, isCardRepaymentInflow } from './cards';
import { kindForCategory, type Kind } from './categories';
import { cleanPayee } from './payee';
import { PAYEE_NAMES, SEED_RULES, type SeedRule } from './seeds';
import { hasTransferMarker, matchesAlias, matchesAnyPattern, sharesWord } from './text';

/**
 * Classification (PRD §7.3) as a pure function: rows in, one result per row out, plus the card
 * accounts that are only ever seen as repayment targets. Order:
 *
 *  0. your decisions that set a kind or category (those rows are settled and never paired)
 *  1. refund and reversal pairs
 *  2. own-account transfers
 *  3. card repayments
 *  4. your rules ("always do this for this payee")
 *  5. investment moves and wallets
 *  6. partner contributions
 *  7. your own name on the other side, with that side's statement not imported
 *  8. seeded merchant rules
 *  9. defaults: plain purchases count, flagged; anything that could be a transfer waits in
 *     Review and counts as nothing (PRD §4.4)
 * 10. your notes, vendors and home-project buckets on top
 *
 * Manual entries are settled by their own decision and are otherwise left alone.
 */

export interface ClassifyRow {
  id: number;
  fingerprint: string;
  accountId: number | null;
  date: string;
  amountCents: number;
  currency: string;
  raw: string;
  manual: boolean;
  /** From a statement that does not reconcile and was not accepted: never paired with anything. */
  held: boolean;
}

export interface ClassifyAccount {
  id: number;
  key: string;
  bank: string;
  kind: AccountKind;
  last4: string;
  owner: Owner;
  seenOnly: boolean;
}

export interface RuleRow {
  id: number;
  source: 'seed' | 'user';
  priority: number;
  field: 'payee' | 'raw';
  pattern: string;
  isRegex: boolean;
  sign: 'in' | 'out' | null;
  accountId: number | null;
  setKind: Kind | null;
  setCategory: string | null;
  setBucket: string | null;
}

export interface DecisionRow {
  fingerprint: string;
  kind: Kind | null;
  category: string | null;
  bucket: string | null;
  vendor: string | null;
  note: string | null;
}

export interface Result {
  id: number;
  payee: string;
  kind: Kind;
  category: string | null;
  bucket: string | null;
  vendor: string | null;
  note: string | null;
  pairFingerprint: string | null;
  target: { accountId?: number; newKey?: string } | null;
  needsReview: boolean;
  classifiedBy: string;
}

export interface NewAccount {
  key: string;
  bank: string;
  product: string;
  kind: 'card';
  last4: string;
}

export interface ClassifyInput {
  rows: ClassifyRow[];
  accounts: ClassifyAccount[];
  settings: Settings;
  rules: RuleRow[];
  decisions: DecisionRow[];
  /** Other card numbers on a card account (supplementary cards), so a bill naming one finds the account. */
  cardAliases?: { last4: string; accountId: number }[];
}

export interface ClassifyOutput {
  /** One result per row, except manual entries without a decision (left as they are). */
  results: Result[];
  newAccounts: NewAccount[];
  accountUpdates: { id: number; bank: string }[];
}

export const INVESTMENT = /Interactive Brokers|\bIBKR\b|\bSYFE\b|ENDOWUS|STASHAWAY|TIGER BROKERS|MOOMOO|\bFUTU\b|WEBULL|\bSAXO\b|FSMONE|\bPOEMS\b|PHILLIP SEC|\bCDP\b|DBS VICKERS|\bIFAST\b/i;
const WALLET_TOPUP = /TOP-UP TO PAYLAH|PAYLAH TOP|GRABPAY TOP|YOUTRIP|REVOLUT|WISE ASIA-PACIFIC/i;
const WALLET_OUT = /MAXED OUT FROM PAYLAH/i;
const HARD_IDENTITY = /\bSALA\b|\bTAXS\b|\bPTXP\b|\bMortgage Loan\b|^Interest (Earned|Credit)/i;
/** Rails that only ever pay a merchant: card terminals and merchant QR codes. */
const PURCHASE_RAIL = /NETS QR|NETS Debit|Point-Of-Sale|Point-of-Sale|Debit Card Transaction|Purchase with Cash|QR PAYMENT|QASHIER|HITPAY/i;
const REFUND_WORD = /\bREFUND\b|\bREVERSAL\b|^CR\b/i;

/** Banks book the two sides of a transfer on different days, especially over a weekend. */
const TRANSFER_WINDOW = 3;
const REFUND_DAYS = 30;
const CARD_PAIR_DAYS = 7;

function canonicalPayee(payee: string, raw: string): string {
  for (const [re, name] of PAYEE_NAMES) if (re.test(raw) || re.test(payee)) return name;
  return payee;
}

export function classify(input: ClassifyInput): ClassifyOutput {
  const { rows, settings } = input;
  const accounts = new Map(input.accounts.map((a) => [a.id, a]));
  const kindOf = (r: ClassifyRow): AccountKind => (r.accountId !== null ? accounts.get(r.accountId)?.kind ?? 'deposit' : 'deposit');
  const isCard = (r: ClassifyRow) => kindOf(r) === 'card';
  const isDeposit = (r: ClassifyRow) => r.accountId !== null && ['deposit', 'wallet'].includes(kindOf(r));
  const payee = new Map(rows.map((r) => [r.id, canonicalPayee(cleanPayee(r.raw, kindOf(r)), r.raw)]));
  const payeeOf = (r: ClassifyRow) => payee.get(r.id)!;
  const selfAlias = (r: ClassifyRow) => matchesAlias(payeeOf(r), settings.self.aliases);
  const partnerLike = (r: ClassifyRow) =>
    r.amountCents > 0 &&
    !isCard(r) &&
    (matchesAlias(payeeOf(r), settings.partner.aliases) ||
      (r.accountId !== null && accounts.get(r.accountId)?.owner === 'joint' && matchesAnyPattern(r.raw, settings.partner.refPatterns)));

  const results = new Map<number, Result>();
  const free = (r: ClassifyRow) => !results.has(r.id) && !r.manual;
  const set = (r: ClassifyRow, partial: Partial<Result> & { kind: Kind; classifiedBy: string }) => {
    results.set(r.id, {
      id: r.id,
      payee: payeeOf(r),
      category: null,
      bucket: null,
      vendor: null,
      note: null,
      pairFingerprint: null,
      target: null,
      needsReview: false,
      ...partial,
    });
  };
  const byDate = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  /** Rows by absolute amount and currency, for the pairing steps. */
  const byAmount = new Map<string, ClassifyRow[]>();
  for (const r of byDate) {
    const k = `${r.currency}:${Math.abs(r.amountCents)}`;
    if (!byAmount.has(k)) byAmount.set(k, []);
    byAmount.get(k)!.push(r);
  }
  const opposites = (r: ClassifyRow) => (byAmount.get(`${r.currency}:${Math.abs(r.amountCents)}`) ?? []).filter((o) => o.amountCents === -r.amountCents);

  /** The first seeded merchant rule a row matches, and the payee name you see for it. */
  const seedFor = (r: ClassifyRow): SeedRule | undefined =>
    SEED_RULES.find((s) => {
      if (s.sign === 'in' && r.amountCents <= 0) return false;
      if (s.sign === 'out' && r.amountCents >= 0) return false;
      // Spending rules never turn money arriving in a bank account into spending.
      if (['spend', 'fee', 'tax'].includes(s.kind) && r.amountCents > 0 && !isCard(r)) return false;
      return s.test.test(`${payeeOf(r)} | ${r.raw}`);
    });
  const shownPayee = (r: ClassifyRow) => seedFor(r)?.payee ?? payeeOf(r);

  // 0. Your decisions that settle what a row is. Those rows take no part in pairing, so the
  // other side of a pair you have changed is free to be classified on its own.
  const decisions = new Map(input.decisions.map((d) => [d.fingerprint, d]));
  for (const r of rows) {
    const d = decisions.get(r.fingerprint);
    const kind = d ? d.kind ?? kindForCategory(d.category) : null;
    if (!d || !kind) continue;
    set(r, {
      kind,
      category: kind === 'spend' || kind === 'income' ? d.category : null,
      bucket: d.bucket,
      vendor: d.vendor,
      note: d.note,
      payee: shownPayee(r),
      classifiedBy: 'decision',
    });
  }

  // 1. Refund and reversal pairs. Money moving between your own accounts is never a refund,
  // and a pair needs evidence: a refund word, the very same text in the same account (a
  // same-day reversal), or a credit on a card from the merchant that charged it.
  // (Marketplace refunds arrive by bank transfer, so a transfer marker only counts without a refund word.)
  const transferish = (r: ClassifyRow) =>
    selfAlias(r) ||
    (hasTransferMarker(r.raw) && !REFUND_WORD.test(r.raw)) ||
    !!cardTarget(r.raw) ||
    INVESTMENT.test(r.raw) ||
    WALLET_TOPUP.test(r.raw) ||
    WALLET_OUT.test(r.raw);
  const refundable = (r: ClassifyRow) => free(r) && !r.held && !transferish(r);
  for (const inn of byDate) {
    if (inn.amountCents <= 0 || !refundable(inn)) continue;
    if (isCard(inn) && isCardRepaymentInflow(inn.raw)) continue;
    const refundWord = REFUND_WORD.test(inn.raw);
    const match = opposites(inn)
      .filter((o) => {
        if (!refundable(o)) return false;
        const sameAccount = o.accountId === inn.accountId;
        if (!sameAccount && !refundWord) return false;
        const d = daysBetween(o.date, inn.date);
        if (d < 0 || d > REFUND_DAYS) return false;
        const alike = sharesWord(o.raw, inn.raw) || sharesWord(payeeOf(o), payeeOf(inn));
        if (refundWord) return alike;
        if (sameAccount && normaliseRaw(o.raw) === normaliseRaw(inn.raw)) return true;
        return sameAccount && isCard(inn) && alike;
      })
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (match) {
      set(match, { kind: 'refund', pairFingerprint: inn.fingerprint, classifiedBy: 'refund-pair' });
      set(inn, { kind: 'refund', pairFingerprint: match.fingerprint, classifiedBy: 'refund-pair' });
    }
  }

  // 2. Your rules, newest and highest priority first. Only your decisions and refund pairs (which
  // cancel out whatever a rule says) come before them, so "always do this for this payee" wins
  // over every other automatic step. A rule on a payee matches the name as you see it,
  // including the tidy names seeded rules give some payees.
  const userRules = input.rules.filter((u) => u.source === 'user').sort((a, b) => b.priority - a.priority || b.id - a.id);
  const ruleHits = (u: RuleRow, r: ClassifyRow): boolean => {
    if (u.sign === 'in' && r.amountCents <= 0) return false;
    if (u.sign === 'out' && r.amountCents >= 0) return false;
    if (u.accountId !== null && u.accountId !== r.accountId) return false;
    const texts = u.field === 'payee' ? [payeeOf(r), shownPayee(r)] : [r.raw];
    if (u.isRegex) {
      try {
        const re = new RegExp(u.pattern, 'i');
        return texts.some((t) => re.test(t));
      } catch {
        return false;
      }
    }
    const want = u.pattern.trim().toLowerCase();
    return u.field === 'payee' ? texts.some((t) => t.trim().toLowerCase() === want) : texts.some((t) => t.toLowerCase().includes(want));
  };
  for (const r of byDate) {
    if (!free(r)) continue;
    const u = userRules.find((x) => ruleHits(x, r));
    const kind = u ? u.setKind ?? kindForCategory(u.setCategory) : null;
    if (u && kind) {
      set(r, {
        kind,
        payee: shownPayee(r),
        category: kind === 'spend' || kind === 'income' ? u.setCategory : null,
        bucket: u.setBucket,
        classifiedBy: `rule:${u.id}`,
      });
    }
  }


  // 3. Own-account transfers. Both sides must look like a transfer (your own name as the
  // counterparty, or a bank-transfer marker): one side naming you is not enough, or a payment
  // to a company could pair with an unrelated transfer of the same amount and vanish.
  const looksLikeTransfer = (r: ClassifyRow) => selfAlias(r) || hasTransferMarker(r.raw);
  const pairable = (r: ClassifyRow) =>
    free(r) &&
    !r.held &&
    isDeposit(r) &&
    !partnerLike(r) &&
    !cardTarget(r.raw) &&
    !INVESTMENT.test(r.raw) &&
    !WALLET_TOPUP.test(r.raw) &&
    !WALLET_OUT.test(r.raw) &&
    !HARD_IDENTITY.test(r.raw) &&
    looksLikeTransfer(r);
  for (const out of byDate) {
    if (out.amountCents >= 0 || !pairable(out)) continue;
    const inn = opposites(out)
      .filter((i) => i.accountId !== out.accountId && Math.abs(daysBetween(out.date, i.date)) <= TRANSFER_WINDOW && pairable(i))
      .sort((a, b) => Math.abs(daysBetween(out.date, a.date)) - Math.abs(daysBetween(out.date, b.date)) || Number(selfAlias(b)) - Number(selfAlias(a)))[0];
    if (inn) {
      set(out, { kind: 'transfer', pairFingerprint: inn.fingerprint, target: { accountId: inn.accountId! }, classifiedBy: 'own-transfer' });
      set(inn, { kind: 'transfer', pairFingerprint: out.fingerprint, target: { accountId: out.accountId! }, classifiedBy: 'own-transfer' });
    }
  }

  // 4. Card repayments: the bank side names the card; the card side receives the money.
  const newAccounts = new Map<string, NewAccount>();
  const accountUpdates = new Map<number, string>();
  const cardByLast4 = new Map<string, ClassifyAccount>();
  for (const a of accounts.values()) if (a.kind === 'card') cardByLast4.set(a.last4, a);
  for (const alias of input.cardAliases ?? []) {
    const a = accounts.get(alias.accountId);
    if (a && !cardByLast4.has(alias.last4)) cardByLast4.set(alias.last4, a);
  }
  const bankSide: { row: ClassifyRow; accountLast4: string }[] = [];
  for (const r of byDate) {
    if (!free(r) || r.amountCents >= 0 || !isDeposit(r)) continue;
    const t = cardTarget(r.raw);
    if (!t) continue;
    const existing = cardByLast4.get(t.last4);
    let target: Result['target'];
    if (existing) {
      target = { accountId: existing.id };
      // A card first seen without an issuer ("CCC - ·1234") learns it from a later bill payment.
      if (existing.seenOnly && !existing.bank && t.issuer) accountUpdates.set(existing.id, t.issuer);
    } else {
      const key = `card:${t.last4}:SGD`;
      const prev = newAccounts.get(key);
      newAccounts.set(key, { key, bank: t.issuer ?? prev?.bank ?? '', product: 'Card', kind: 'card', last4: t.last4 });
      target = { newKey: key };
    }
    set(r, { kind: 'card-repayment', target, classifiedBy: 'card-repayment' });
    bankSide.push({ row: r, accountLast4: existing?.last4 ?? t.last4 });
  }
  for (const r of byDate) {
    if (!free(r) || r.amountCents <= 0 || !isCard(r) || !isCardRepaymentInflow(r.raw)) continue;
    const last4 = accounts.get(r.accountId!)!.last4;
    const match = bankSide
      .filter(
        (b) =>
          b.accountLast4 === last4 &&
          b.row.amountCents === -r.amountCents &&
          Math.abs(daysBetween(b.row.date, r.date)) <= CARD_PAIR_DAYS &&
          results.get(b.row.id)!.pairFingerprint === null,
      )
      .sort((a, b) => Math.abs(daysBetween(a.row.date, r.date)) - Math.abs(daysBetween(b.row.date, r.date)))[0];
    set(r, { kind: 'card-repayment', pairFingerprint: match?.row.fingerprint ?? null, classifiedBy: 'card-repayment' });
    if (match) results.get(match.row.id)!.pairFingerprint = r.fingerprint;
  }

  // 5. Investment moves (from bank accounts) and wallets.
  for (const r of byDate) {
    if (!free(r)) continue;
    if (isDeposit(r) && INVESTMENT.test(r.raw)) set(r, { kind: 'investment', classifiedBy: 'investment' });
    else if (r.amountCents < 0 && WALLET_TOPUP.test(r.raw)) set(r, { kind: 'wallet-topup', classifiedBy: 'wallet' });
    else if (r.amountCents > 0 && isDeposit(r) && WALLET_OUT.test(r.raw)) set(r, { kind: 'transfer', classifiedBy: 'wallet' });
  }

  // 6. Partner contributions.
  for (const r of byDate) {
    if (free(r) && partnerLike(r)) set(r, { kind: 'partner-contribution', classifiedBy: 'partner' });
  }

  // 7. Your own name on the other side, with that side's statement not imported.
  for (const r of byDate) {
    if (free(r) && isDeposit(r) && selfAlias(r)) set(r, { kind: 'transfer', classifiedBy: 'self-alias' });
  }

  // 8. Seeded merchant rules.
  for (const r of byDate) {
    if (!free(r)) continue;
    const s = seedFor(r);
    if (s) {
      set(r, { kind: s.kind, category: s.category ?? null, bucket: s.bucket ?? null, payee: s.payee ?? payeeOf(r), classifiedBy: `seed:${s.id}` });
    }
  }

  // 9. Defaults. A card purchase, or a payment through a card terminal or merchant QR code,
  // is spending: it counts, flagged so you can pick its category. Anything else could be a
  // transfer, so it waits in Review and counts as nothing until you say what it is.
  for (const r of byDate) {
    if (!free(r)) continue;
    if (r.amountCents < 0 && (isCard(r) || PURCHASE_RAIL.test(r.raw))) {
      set(r, { kind: 'spend', category: 'Other', needsReview: true, classifiedBy: 'default' });
    } else {
      set(r, { kind: 'unclassified', needsReview: true, classifiedBy: 'default' });
    }
  }

  // 10. Notes, vendors and buckets you added without changing what a row is.
  for (const r of rows) {
    const d = decisions.get(r.fingerprint);
    const current = results.get(r.id);
    if (!d || !current || current.classifiedBy === 'decision') continue;
    results.set(r.id, {
      ...current,
      bucket: d.bucket ?? current.bucket,
      vendor: d.vendor ?? current.vendor,
      note: d.note ?? current.note,
    });
  }

  return {
    results: rows.flatMap((r) => (results.has(r.id) ? [results.get(r.id)!] : [])),
    newAccounts: [...newAccounts.values()].sort((a, b) => a.key.localeCompare(b.key)),
    accountUpdates: [...accountUpdates].map(([id, bank]) => ({ id, bank })),
  };
}
