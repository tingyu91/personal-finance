/** Text helpers shared by the classification steps. */

/** Words that say how money moved, not who it moved to. They never make two rows "the same payee". */
const GENERIC = new Set(
  [
    'advice', 'payment', 'payments', 'receipt', 'transfer', 'transfers', 'paynow', 'fast', 'giro', 'bill', 'funds',
    'fund', 'inward', 'outward', 'credit', 'debit', 'other', 'othr', 'incoming', 'mobile', 'ref', 'top', 'maxed',
    'from', 'paylah', 'singapore', 'pte', 'ltd', 'the', 'and', 'with', 'for', 'collections', 'via', 'transaction',
    'point', 'sale', 'proceeds', 'nets', 'card', 'bank', 'banking', 'refund', 'reversal', 'trf', 'charges', 'value',
    'date', 'supplier', 'misc', 'purchase', 'withdrawal', 'deposit', 'quick', 'cheque', 'interest', 'account',
  ].map((w) => w.toLowerCase()),
);

/**
 * Letters-only words of four or more characters that are not generic banking words.
 * "Transaction" is generic in bank text but meaningful after "To:"; keep it only there.
 */
export function significantWords(text: string): string[] {
  const out: string[] = [];
  const counterparty = /\b(?:to|from):\s*([^·]+)/i.exec(text)?.[1] ?? '';
  const keepTransaction = /transaction/i.test(counterparty);
  for (const raw of text.toLowerCase().split(/[^a-z]+/)) {
    if (raw.length < 4) continue;
    if (/^[a-z]{4}sgsg/.test(raw)) continue; // bank SWIFT-style references, e.g. …OCBCSGSGBRT…
    if (GENERIC.has(raw) && !(raw === 'transaction' && keepTransaction)) continue;
    if (!out.includes(raw)) out.push(raw);
  }
  return out;
}

/** Two texts share a significant word when one word starts with another of 5+ letters. */
export function sharesWord(a: string, b: string): boolean {
  const wa = significantWords(a);
  const wb = significantWords(b);
  return wa.some((x) => wb.some((y) => (x.length >= 5 && y.startsWith(x)) || (y.length >= 5 && x.startsWith(y)) || x === y));
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when any alias appears as whole words in the text (case-insensitive). */
export function matchesAlias(text: string, aliases: string[]): boolean {
  return aliases.some((a) => a.trim() && new RegExp(`(^|[^A-Za-z])${escape(a.trim())}($|[^A-Za-z])`, 'i').test(text));
}

/** Plain-text (not regex) containment, case-insensitive. */
export function matchesAnyPattern(text: string, patterns: string[]): boolean {
  const t = text.toUpperCase();
  return patterns.some((p) => p.trim() && t.includes(p.trim().toUpperCase()));
}

/** Signs that a row moved money between bank accounts rather than paying someone. */
const TRANSFER_MARKERS = [/:I-BANK\b/i, /:IB\b/, /\bFunds Trf\b/i, /\bFUNDS TRANSFER\b/i, /UOVBSGSG/, /DBSSSGSG/, /POSBSGSG/, /\bINWARD TRF\b/i];

export function hasTransferMarker(raw: string): boolean {
  return TRANSFER_MARKERS.some((re) => re.test(raw));
}
