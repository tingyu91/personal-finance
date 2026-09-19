import { inferYear, isoFromDayMon, monthOf, parseDayMonYear } from '../core/dates';
import { lastFour } from '../core/redact';
import { amountOf, findLine, headerColumns, nearestColumn, textBetween } from './kit';
import type { Adapter, ParsedStatement, PdfLine } from './types';

/**
 * DBS/POSB savings account statement. Rows are dated "dd Mon" (year from the "As at" line),
 * continuation lines are indented, and the balance prints only on the last row of each day.
 */

type Col = 'debit' | 'credit' | 'balance';
const HEADER = { debit: /^WITHDRAWAL/, credit: /^DEPOSIT/, balance: /^BALANCE/ };
const DESC_X = 90; // descriptions start at ~97, continuation lines at ~102
const FOOTER_Y = 30;
const ACCOUNT = /^Details of Your (DBS|POSB) (.+?)\s+Account No\.?:?\s*([\d-]+)$/;

function amounts(line: PdfLine, cols: Record<Col, number>): Partial<Record<Col, number>> {
  const out: Partial<Record<Col, number>> = {};
  for (const item of line.items) {
    const a = amountOf(item.str);
    if (!a) continue;
    const col = nearestColumn(item, cols);
    if (col) out[col] = a.cents;
  }
  return out;
}

function firstAmountX(line: PdfLine): number {
  return line.items.find((i) => i.x >= DESC_X && amountOf(i.str))?.x ?? Infinity;
}

export const dbsSavingsAdapter: Adapter = {
  id: 'dbs-savings',
  version: 1,
  bank: 'DBS',
  kind: 'savings',

  detect(text) {
    const hits = [/Details of Your (DBS|POSB)/, /DETAILS OF TRANSACTIONS/, /WITHDRAWAL\(\$\)/, /As at \d{1,2} [A-Za-z]{3} \d{4}/].filter((re) =>
      re.test(text),
    ).length;
    return hits === 4 ? 0.9 : 0;
  },

  parse(doc) {
    const asAt = findLine(doc, /^As at \d/)?.text.replace(/^As at /, '');
    const end = asAt ? parseDayMonYear(asAt) : null;
    if (!end) throw new Error('No "As at" date');
    const month = monthOf(end);
    const [year, mon] = month.split('-').map(Number) as [number, number];

    const statements = new Map<string, ParsedStatement>();
    let current: ParsedStatement | null = null;
    let opened = false;
    let cols: Record<Col, number> | null = null;
    let inTable = false;
    let closed = false;

    for (const page of doc.pages) {
      inTable = false;
      for (const line of page.lines) {
        if (line.y < FOOTER_Y) continue;
        const text = line.text;

        const acct = ACCOUNT.exec(text);
        if (acct) {
          const last4 = lastFour(acct[3]!) ?? '';
          current = statements.get(last4) ?? null;
          if (!current) {
            current = {
              account: { bank: acct[1]!, product: acct[2]!.trim(), kind: 'deposit', last4, currency: 'SGD', owner: 'me' },
              period: { start: `${month}-01`, end, month },
              openingCents: 0,
              closingCents: 0,
              printed: {},
              rows: [],
            };
            statements.set(last4, current);
            opened = false;
            closed = false;
          }
          continue;
        }
        const header = headerColumns(line, HEADER);
        if (header && /^DATE/.test(text)) {
          cols = header;
          inTable = true;
          continue;
        }
        if (!current || !cols || !inTable) continue;

        if (/^Balance Brought Forward/.test(text)) {
          const a = amounts(line, cols);
          if (!opened && a.balance !== undefined) {
            current.openingCents = a.balance;
            opened = true;
          }
          continue;
        }
        if (/^Total\b/.test(text)) {
          const a = amounts(line, cols);
          current.printed.debitsCents = a.debit ?? 0;
          current.printed.creditsCents = a.credit ?? 0;
          closed = true;
          continue;
        }
        if (/^Balance Carried Forward/.test(text)) {
          const a = amounts(line, cols);
          if (closed && a.balance !== undefined) {
            current.closingCents = a.balance;
            current.printed.closingCents = a.balance;
          }
          inTable = false;
          continue;
        }
        if (closed) continue;

        const first = line.items[0]!;
        const dm = first.x < DESC_X ? /^(\d{1,2}) ([A-Za-z]{3})$/.exec(first.str) : null;
        if (dm) {
          const rowMonth = isoFromDayMon(first.str, year);
          const date = rowMonth ? isoFromDayMon(first.str, inferYear(Number(rowMonth.slice(5, 7)), year, mon)) : null;
          const a = amounts(line, cols);
          if (!date || (a.debit === undefined && a.credit === undefined)) continue;
          const desc = textBetween(line, DESC_X, firstAmountX(line) - 1);
          current.rows.push({
            date,
            lines: desc ? [desc] : [],
            amountCents: a.debit !== undefined ? -a.debit : a.credit!,
            balanceCents: a.balance,
          });
          continue;
        }
        const row = current.rows.at(-1);
        if (row && first.x >= DESC_X && firstAmountX(line) === Infinity) row.lines.push(text);
      }
    }
    return [...statements.values()];
  },
};
