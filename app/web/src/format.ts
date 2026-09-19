/** Money is integer cents; these format at the render boundary only (PRD §6). */

export const MINUS = '−';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function group(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "S$1,234.56" from 123456. Unsigned: callers add the sign. `round` drops cents (headlines only). */
export function formatSGD(cents: number, opts: { round?: boolean; currency?: string } = {}): string {
  const abs = Math.abs(Math.round(cents));
  const prefix = opts.currency ?? 'S$';
  if (opts.round) return `${prefix}${group(Math.round(abs / 100))}`;
  return `${prefix}${group(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, '0')}`;
}

/** Compact headline figures: S$38.2k, S$1.2M. Headlines only, never tables. */
export function formatCompact(cents: number): string {
  const dollars = Math.abs(cents) / 100;
  if (dollars >= 1_000_000) return `S$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 10_000) return `S$${(dollars / 1_000).toFixed(1)}k`;
  return formatSGD(cents, { round: true });
}

/** "07 Aug" */
export function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]} ${MONTHS[Number(m[2]) - 1]!.slice(0, 3)}`;
}

/** "7 Aug 2026" */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]!.slice(0, 3)} ${m[1]}`;
}

/** "August 2026", or "Aug 2026" with `short`, or "Aug" with `tiny`. */
export function monthLabel(month: string, form: 'long' | 'short' | 'tiny' = 'long'): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const name = MONTHS[m - 1]!;
  if (form === 'tiny') return name.slice(0, 3);
  return `${form === 'short' ? name.slice(0, 3) : name} ${y}`;
}

/** The calendar date in Singapore (UTC+8, no daylight saving) of a UTC timestamp. */
export function sgtDate(timestamp: string | number | Date): string {
  const t = new Date(timestamp).getTime() + 8 * 3_600_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Today in Singapore, "2026-09-19". */
export function sgtToday(): string {
  return sgtDate(Date.now());
}

export function percent(ratio: number | null): string {
  return ratio === null ? '—' : `${Math.round(ratio * 100)}%`;
}
