import { isoFromDayMon, monthIndex, monthOf, parseDayMonYear } from '../core/dates';
import { lastFour } from '../core/redact';
import { amountOf, headerColumns, nearestColumn, textBetween } from './kit';
import type { Adapter, ParsedStatement, PdfLine } from './types';

/**
 * UOB deposit statement ("Statement of Account"), e.g. the One Account. Rows are dated
 * "dd Mon" (year from the Period line), every row prints its balance, and page 1 carries the
 * bank's own eligible-spend and bonus-interest figures. The file name says nothing
 * (eStatement*.pdf), so everything comes from the contents.
 */

type Col = 'debit' | 'credit' | 'balance';
const HEADER = { debit: /^Withdrawals$/, credit: /^Deposits$/, balance: /^Balance$/ };
const DESC_X = 100;
const FOOTER_Y = 60;
const ACCOUNT_LINE = /^(.+?)\s+(\d[\d-]{7,}\d)(?:\s+\(continued\))?$/;

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

/** The last item of a "label … value" line: an amount in cents, null for "-", undefined if absent. */
function trailingValue(line: PdfLine): number | null | undefined {
  const last = line.items.at(-1)?.str;
  if (last === '-') return null;
  const a = last ? amountOf(last) : null;
  return a ? a.cents : undefined;
}

function overviewMeta(lines: PdfLine[]): { perProduct: Map<string, number>; one: Record<string, number | string | null> } {
  const perProduct = new Map<string, number>();
  const one: Record<string, number | string | null> = {};
  let cols: { interest: number } | null = null;
  for (const line of lines) {
    const h = headerColumns(line, { interest: /^Interest Earned/ });
    if (h && /Currency/.test(line.text)) {
      cols = h;
      continue;
    }
    if (cols && line.items.length > 2 && line.items[1]?.str === 'SGD') {
      const interest = line.items.find((i) => amountOf(i.str) && nearestColumn(i, cols!, 20) === 'interest');
      if (interest) perProduct.set(line.items[0]!.str, amountOf(interest.str)!.cents);
    }
    const v = trailingValue(line);
    if (/^Credit Card Eligible Spend/.test(line.text) && v !== undefined) one.creditCardEligibleSpendCents = v;
    else if (/^Debit Card Eligible Spend/.test(line.text) && v !== undefined) one.debitCardEligibleSpendCents = v;
    else if (/^Bonus Interest earned/.test(line.text) && v !== undefined) one.bonusInterestCents = v;
    const forMonth = /^\^for ([A-Za-z]+) (\d{4})$/.exec(line.text);
    if (forMonth) {
      const m = monthIndex(forMonth[1]!);
      if (m) one.eligibleSpendMonth = `${forMonth[2]}-${String(m).padStart(2, '0')}`;
    }
  }
  return { perProduct, one };
}

export const uobOneAdapter: Adapter = {
  id: 'uob-deposit',
  version: 1,
  bank: 'UOB',
  kind: 'one-account',

  detect(text) {
    const hits = [/United Overseas Bank|uob\.com\.sg/i, /Statement of Account/, /Account Transaction Details/, /Period: \d{2} [A-Za-z]{3} \d{4} to/].filter((re) =>
      re.test(text),
    ).length;
    return hits === 4 ? 0.9 : 0;
  },

  parse(doc) {
    const periodLine = doc.pages[0]?.lines.find((l) => /^Period: /.test(l.text));
    const pm = periodLine ? /^Period: (\d{2} [A-Za-z]{3} \d{4}) to (\d{2} [A-Za-z]{3} \d{4})$/.exec(periodLine.text) : null;
    const start = pm ? parseDayMonYear(pm[1]!) : null;
    const end = pm ? parseDayMonYear(pm[2]!) : null;
    if (!start || !end) throw new Error('No "Period:" line');
    const month = monthOf(end);
    const startYear = Number(start.slice(0, 4));
    const endYear = Number(end.slice(0, 4));

    const statements = new Map<string, ParsedStatement>();
    let current: ParsedStatement | null = null;
    let cols: Record<Col, number> | null = null;
    let inDetails = false;
    let inTable = false;
    let done = false;
    const overview: PdfLine[] = [];
    const closed = new Set<ParsedStatement>();

    for (const page of doc.pages) {
      inTable = false;
      for (const line of page.lines) {
        const text = line.text;
        if (!inDetails) {
          if (/^Account Transaction Details/.test(text)) inDetails = true;
          else overview.push(line);
          continue;
        }
        if (line.y < FOOTER_Y || done) continue;
        if (/End of Transaction Details/.test(text)) {
          done = true;
          continue;
        }
        const first = line.items[0]!;
        const acct = first.x < DESC_X && !/^\d{2} [A-Za-z]{3}$/.test(first.str) ? ACCOUNT_LINE.exec(text) : null;
        if (acct) {
          const last4 = lastFour(acct[2]!) ?? '';
          current = statements.get(last4) ?? null;
          if (!current) {
            current = {
              account: { bank: 'UOB', product: acct[1]!.trim(), kind: 'deposit', last4, currency: 'SGD', owner: 'me' },
              period: { start, end, month },
              openingCents: 0,
              closingCents: 0,
              printed: {},
              rows: [],
            };
            statements.set(last4, current);
          }
          continue;
        }
        const header = headerColumns(line, HEADER);
        if (header && /^Date/.test(text)) {
          cols = header;
          inTable = true;
          continue;
        }
        if (!current || !cols || !inTable) continue;
        if (/^(SGD\s*)+$/.test(text)) continue;

        if (/^Total\b/.test(text)) {
          const a = amounts(line, cols);
          current.printed = { debitsCents: a.debit ?? 0, creditsCents: a.credit ?? 0, closingCents: a.balance };
          current.closingCents = a.balance ?? current.openingCents + current.rows.reduce((t, r) => t + r.amountCents, 0);
          closed.add(current);
          continue;
        }
        // Anything printed after an account's Total line (footnotes) is not part of a row.
        if (closed.has(current)) continue;
        const dm = first.x < DESC_X ? /^(\d{2}) ([A-Za-z]{3})$/.exec(first.str) : null;
        if (dm) {
          const mon = monthIndex(dm[2]!);
          const year = startYear !== endYear && mon !== null && mon > 6 ? startYear : endYear;
          const date = isoFromDayMon(first.str, year);
          const a = amounts(line, cols);
          const desc = textBetween(line, DESC_X, firstAmountX(line) - 1);
          if (/^BALANCE B\/F/.test(desc)) {
            if (a.balance !== undefined && current.rows.length === 0) current.openingCents = a.balance;
            continue;
          }
          if (!date || (a.debit === undefined && a.credit === undefined)) continue;
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

    const { perProduct, one } = overviewMeta(overview);
    for (const s of statements.values()) {
      const meta: Record<string, number | string | null> = {};
      if (/One Account/i.test(s.account.product)) Object.assign(meta, one);
      const ytd = perProduct.get(s.account.product);
      if (ytd !== undefined) meta.interestEarnedYtdCents = ytd;
      if (Object.keys(meta).length) s.meta = meta;
    }
    return [...statements.values()];
  },
};
