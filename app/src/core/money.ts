/** Money is integer cents (SGD) everywhere. These helpers never go through floats. */

const AMOUNT = /^(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})$/;

/** "1,234.56" → 123456. Anything that is not a plain two-decimal amount → null. */
export function parseAmount(s: string): number | null {
  const m = AMOUNT.exec(s.trim());
  if (!m) return null;
  return Number(m[1]!.replace(/,/g, '')) * 100 + Number(m[2]);
}

const MINUS = '−';

/** Plain formatter for logs and the CLI. The UI has its own in the design-system port. */
export function formatSGD(cents: number): string {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString('en-SG');
  const frac = String(abs % 100).padStart(2, '0');
  return `${cents < 0 ? MINUS : ''}S$${whole}.${frac}`;
}
