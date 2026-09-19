/**
 * Card repayments (PRD §7.3 step 3). A bank-side bill payment names the card by its last four;
 * the issuer is known only when the biller name says so ("CCC" is any card).
 */

const BILLS: [RegExp, string | null][] = [
  [/\bCCC - ·(\d{4})\b/, null],
  [/\bAMEX-·(\d{4})\b/, 'Amex'],
  [/\bmBK-AMEX · ·(\d{4})\b/, 'Amex'],
  [/\bmBK-Citi CC · ·(\d{4})\b/, 'Citi'],
  [/\bmBK-UOB Cards · ·(\d{4})\b/, 'UOB'],
  [/\bmBK-DBS Cards · ·(\d{4})\b/, 'DBS'],
  [/\bmBK-OCBC Cards · ·(\d{4})\b/, 'OCBC'],
];

export function cardTarget(raw: string): { issuer: string | null; last4: string } | null {
  if (!/Bill Payment/i.test(raw)) return null;
  for (const [re, issuer] of BILLS) {
    const m = re.exec(raw);
    if (m) return { issuer, last4: m[1]! };
  }
  return null;
}

/** Money arriving on a card that pays the bill (as opposed to a merchant refund or a fee reversal). */
const REPAYMENT_IN = [/Visa Direct/i, /^PAYMT THRU/i, /^DBS BANK\b/i, /^PAYMENT\b/i, /\bGIRO PAYMENT\b/i, /^FAST PAYMENT\b/i, /\bBILL PAYMENT\b/i, /PAYMENT RECEIVED/i];

export function isCardRepaymentInflow(raw: string): boolean {
  return REPAYMENT_IN.some((re) => re.test(raw));
}
