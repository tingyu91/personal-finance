import type { PdfDoc, PdfItem, PdfLine, PdfPage } from '../../src/adapters/types';

/**
 * Builders for synthetic statement fixtures. Everything in test/fixtures is invented: names,
 * numbers and amounts. Widths are approximated as 4.6pt per character, which is close enough
 * for column detection because headers and amounts use the same approximation.
 */
const CHAR_W = 4.6;

type Cell = Omit<PdfItem, 'y'>;

/** An item that starts at x. */
export function at(x: number, str: string): Cell {
  const w = str.length * CHAR_W;
  return { str, x, w, r: x + w };
}

/** A right-aligned item that ends at r (amount columns and their headers). */
export function right(r: number, str: string): Cell {
  const w = str.length * CHAR_W;
  return { str, x: r - w, w, r };
}

export function line(y: number, ...cells: Cell[]): PdfLine {
  const items = cells.map((c) => ({ ...c, y })).sort((a, b) => a.x - b.x);
  return { y, items, text: items.map((i) => i.str).join(' ') };
}

export function page(number: number, ...lines: PdfLine[]): PdfPage {
  return { number, lines: [...lines].sort((a, b) => b.y - a.y) };
}

export function doc(...pages: PdfPage[]): PdfDoc {
  return { pages };
}

/** Lays lines out top-down from `top`, `step` points apart. */
export function stack(top: number, step: number, rows: Cell[][]): PdfLine[] {
  return rows.map((cells, i) => line(top - i * step, ...cells));
}
