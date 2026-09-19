/**
 * Redaction at import (PRD §6). Statements carry NRICs (IRAS GIRO lines), full card and
 * account numbers, and home addresses. Addresses are never read by the adapters; the other
 * two are masked here before anything is stored.
 */

const NRIC = /\b[STFGM]\d{7}[A-Z]\b/g;
/**
 * Digit runs: dashes join groups (account formats like 123-456789-0); spaces join only the
 * card format of four-digit groups, so "·1111 1234567" stays two separate numbers.
 */
const DIGIT_RUN = /\d{4}(?: \d{4}){2,3}(?!\d)|\d+(?:-\d+)*/g;
/** Seven digits and a letter, e.g. IRAS GIRO references that can point to a property. */
const REF7 = /\b\d{7}[A-Z]\b/g;

const MIN_DIGITS = 8;
const DATE = /^(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})$/;

function isIdentifierRun(m: string): boolean {
  return m.replace(/\D/g, '').length >= MIN_DIGITS && !DATE.test(m);
}

export function redact(text: string): string {
  return text
    .replace(NRIC, '[NRIC]')
    .replace(REF7, (m) => `·${m.slice(3)}`)
    .replace(DIGIT_RUN, (m) => (isIdentifierRun(m) ? `·${m.replace(/\D/g, '').slice(-4)}` : m));
}

/** Last four digits of the longest digit run, or null when there are none. */
export function lastFour(text: string): string | null {
  let best = '';
  for (const m of text.match(DIGIT_RUN) ?? []) {
    const digits = m.replace(/\D/g, '');
    if (digits.length > best.length) best = digits;
  }
  return best.length >= 4 ? best.slice(-4) : null;
}

/** Everything that redaction would have removed. Used by the database scan. */
export function findIdentifiers(text: string): string[] {
  const found: string[] = [];
  for (const m of text.match(NRIC) ?? []) found.push(m);
  for (const m of text.match(DIGIT_RUN) ?? []) {
    if (isIdentifierRun(m)) found.push(m.trim());
  }
  return found;
}
