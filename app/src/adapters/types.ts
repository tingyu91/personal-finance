/** Text as pdf.js lays it out: items keep their left edge, width and right edge. */
export interface PdfItem {
  str: string;
  x: number;
  y: number;
  w: number;
  r: number;
}

export interface PdfLine {
  y: number;
  items: PdfItem[];
  text: string;
}

export interface PdfPage {
  number: number;
  lines: PdfLine[];
}

export interface PdfDoc {
  pages: PdfPage[];
}

export type AccountKind = 'deposit' | 'card' | 'wallet' | 'loan' | 'investment';
export type Owner = 'me' | 'joint' | 'partner';

export interface AccountRef {
  bank: string;
  product: string;
  kind: AccountKind;
  last4: string;
  currency: string;
  owner: Owner;
}

export interface ParsedRow {
  /** Transaction date (ISO). Reports use this. */
  date: string;
  /** Card post date (ISO), when the statement prints one. */
  postDate?: string;
  /** Description lines as printed (unredacted until import). */
  lines: string[];
  /** Signed from the household's side: negative is money out. */
  amountCents: number;
  /** Running balance printed on this row, if any. */
  balanceCents?: number;
  fx?: { currency: string; amountCents: number };
  cardholder?: string;
  cardLast4?: string;
}

export interface Subtotal {
  label: string;
  openingCents: number;
  cents: number;
  rowIdx: number[];
}

export interface PrintedFigures {
  debitsCents?: number;
  creditsCents?: number;
  closingCents?: number;
  amountDueCents?: number;
  subtotals?: Subtotal[];
}

export interface ParsedStatement {
  account: AccountRef;
  period: { start: string; end: string; month: string };
  openingCents: number;
  closingCents: number;
  printed: PrintedFigures;
  rows: ParsedRow[];
  /** Balance checkpoints printed without a transaction (date, balance after that day). */
  checkpoints?: { afterRow: number; balanceCents: number }[];
  meta?: Record<string, number | string | null>;
}

export interface Adapter {
  id: string;
  version: number;
  bank: string;
  /** Short statement kind used in vault names: consolidated, savings, one-account, card. */
  kind: string;
  /** 0..1: how sure this adapter is that the text is its layout. */
  detect(text: string): number;
  parse(doc: PdfDoc): ParsedStatement[];
}
