import { parseAmount } from '../core/money';
import type { PdfDoc, PdfItem, PdfLine } from './types';

/** Small, layout-agnostic helpers shared by the adapters. */

const AMOUNT_ITEM = /^([\d,]+\.\d{2})(?:\s?(CR))?$/;

export function isAmount(s: string): boolean {
  const m = AMOUNT_ITEM.exec(s.trim());
  return !!m && parseAmount(m[1]!) !== null;
}

export function amountOf(s: string): { cents: number; credit: boolean } | null {
  const m = AMOUNT_ITEM.exec(s.trim());
  if (!m) return null;
  const cents = parseAmount(m[1]!);
  return cents === null ? null : { cents, credit: m[2] === 'CR' };
}

/** Parses "1,234.56" or "SGD 1,234.56" (currency prefix allowed). */
export function centsOf(s: string): number | null {
  const m = /^(?:[A-Z]{3}\s+)?([\d,]+\.\d{2})$/.exec(s.trim());
  return m ? parseAmount(m[1]!) : null;
}

export function docText(doc: PdfDoc): string {
  return doc.pages.map((p) => p.lines.map((l) => l.text).join('\n')).join('\n');
}

/** Right edges of the named columns in a header line (rounded to 0.1pt). */
export function headerColumns<K extends string>(line: PdfLine, labels: Record<K, RegExp>): Record<K, number> | null {
  const out = {} as Record<K, number>;
  for (const [name, re] of Object.entries(labels) as [K, RegExp][]) {
    const hit = line.items.find((i) => re.test(i.str));
    if (!hit) return null;
    out[name] = Math.round(hit.r * 10) / 10;
  }
  return out;
}

const COLUMN_TOLERANCE = 14;

/** The column whose right edge is closest to the item's right edge, within tolerance. */
export function nearestColumn<K extends string>(item: Pick<PdfItem, 'r'>, cols: Record<K, number>, tolerance = COLUMN_TOLERANCE): K | null {
  let best: K | null = null;
  let bestD = Infinity;
  for (const [name, r] of Object.entries(cols) as [K, number][]) {
    const d = Math.abs(item.r - r);
    if (d < bestD) {
      best = name;
      bestD = d;
    }
  }
  return bestD <= tolerance ? best : null;
}

/** Text of the items in a line that start at or after `fromX` and end before `beforeX`. */
export function textBetween(line: PdfLine, fromX: number, beforeX = Infinity): string {
  return line.items
    .filter((i) => i.x >= fromX - 1 && i.r <= beforeX + 1)
    .map((i) => i.str)
    .join(' ')
    .trim();
}

export function findLine(doc: PdfDoc, re: RegExp): PdfLine | undefined {
  for (const p of doc.pages) for (const l of p.lines) if (re.test(l.text)) return l;
  return undefined;
}

export function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}
