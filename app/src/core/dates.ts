/** Dates are ISO YYYY-MM-DD strings (SGT, no time). All arithmetic is done in UTC. */

export const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;
export const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function valid(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function monthIndex(name: string): number | null {
  const i = MONTHS.indexOf(name.slice(0, 3).toLowerCase() as (typeof MONTHS)[number]);
  return i < 0 || name.length < 3 ? null : i + 1;
}

/** "01/08/2026" → "2026-08-01" */
export function isoFromDmy(s: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  return m ? valid(Number(m[3]), Number(m[2]), Number(m[1])) : null;
}

/** "22 JUL" + 2026 → "2026-07-22" */
export function isoFromDayMon(s: string, year: number): string | null {
  const m = /^(\d{1,2}) ([A-Za-z]{3})$/.exec(s.trim());
  if (!m) return null;
  const mon = monthIndex(m[2]!);
  return mon ? valid(year, mon, Number(m[1])) : null;
}

/** "20 AUG 2026" → "2026-08-20" */
export function parseDayMonYear(s: string): string | null {
  const m = /^(\d{1,2}) ([A-Za-z]{3,9}) (\d{4})$/.exec(s.trim());
  if (!m) return null;
  const mon = monthIndex(m[2]!);
  return mon ? valid(Number(m[3]), mon, Number(m[1])) : null;
}

/** A row month after the statement month belongs to the previous year (Dec rows on a Jan statement). */
export function inferYear(month: number, refYear: number, refMonth: number): number {
  return month > refMonth ? refYear - 1 : refYear;
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function fromDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(iso: string, n: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fromDate(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
}

/** "2026-08" + -1 → "2026-07" */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/** Last day of a "YYYY-MM" month as ISO. */
export function monthEnd(month: string): string {
  return addDays(`${addMonths(month, 1)}-01`, -1);
}

/** A timestamp (ISO, any zone) as a calendar date in Singapore (UTC+8). */
export function sgtDate(timestamp: string): string {
  return fromDate(new Date(Date.parse(timestamp) + 8 * 3_600_000));
}

/** "2026-09-19" → "19 Sep 2026" */
export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTH_LABELS[m - 1]} ${y}`;
}

/** "2026-08" → "Aug 2026" */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${MONTH_LABELS[m - 1]} ${y}`;
}
