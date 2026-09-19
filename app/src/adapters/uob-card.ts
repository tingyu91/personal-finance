import { addDays, inferYear, isoFromDayMon, monthOf, parseDayMonYear } from '../core/dates';
import { lastFour } from '../core/redact';
import { amountOf, findLine, textBetween, titleCase } from './kit';
import type { Adapter, ParsedStatement, PdfLine, Subtotal } from './types';

/**
 * UOB credit card statement: one PDF covers every card, with one section per cardholder.
 * The first section of each product belongs to the principal card listed in the summary;
 * later sections of that product are supplementary cards (the partner's, in the sample).
 * Amounts are signed from the household's side: a charge is negative, a CR is positive.
 */

const DATE = /^(\d{2}) ([A-Z]{3})$/;
const CARD = /^(\d{4}-\d{4}-\d{4}-\d{4})\s+(.+?)(?:\s+\(continued\))?$/;
const PRODUCT = /^[A-Z][A-Z0-9 &'/-]+$/;
const FX = /^([A-Z]{3}) ([\d,]+\.\d{2})$/;
const DESC_X = 140;
const FOOTER_Y = 55;

const WORDS: Record<string, string> = { Uob: 'UOB', Krisflyer: 'KrisFlyer', Prvi: 'PRVI', Evol: 'EVOL' };

export function prettyProduct(name: string): string {
  return titleCase(name)
    .split(' ')
    .map((w) => WORDS[w] ?? w)
    .join(' ');
}

interface Section extends Subtotal {
  holder: string;
  last4: string;
}

interface Account {
  statement: ParsedStatement;
  sections: Section[];
}

function lastAmount(line: PdfLine): { cents: number; credit: boolean } | null {
  const last = line.items.at(-1);
  return last && last.x > 300 ? amountOf(last.str) : null;
}

export const uobCardAdapter: Adapter = {
  id: 'uob-card',
  version: 1,
  bank: 'UOB',
  kind: 'card',

  detect(text) {
    const hits = [/Credit Card\(s\) Statement/, /United Overseas Bank|uob\.com\.sg/i, /Statement Date/, /TOTAL BALANCE FOR /].filter((re) => re.test(text)).length;
    return hits === 4 ? 0.95 : 0;
  },

  parse(doc) {
    const dateLine = findLine(doc, /^Statement Date /);
    const end = dateLine ? parseDayMonYear(dateLine.text.replace(/^Statement Date /, '')) : null;
    if (!end) throw new Error('No "Statement Date"');
    const month = monthOf(end);
    const [year, mon, day] = end.split('-').map(Number) as [number, number, number];
    const prev = new Date(Date.UTC(year, mon - 2, Math.min(day, new Date(Date.UTC(year, mon - 1, 0)).getUTCDate())));
    const start = addDays(prev.toISOString().slice(0, 10), 1);

    // Summary table: principal cards and their amounts to pay.
    const due = new Map<string, number>();
    for (const line of doc.pages[0]?.lines ?? []) {
      const card = line.items.find((i) => /^\d{4}-\d{4}-\d{4}-\d{4}$/.test(i.str));
      if (!card || line.items[0] === card) continue;
      const amounts = line.items.filter((i) => i.x > card.x && amountOf(i.str));
      const last4 = lastFour(card.str);
      if (last4 && amounts[0]) due.set(last4, amountOf(amounts[0].str)!.cents);
    }

    const accounts: Account[] = [];
    let account: Account | null = null;
    let section: Section | null = null;
    let pendingProduct: string | null = null;
    let done = false;

    const rowDate = (s: string, refYear: number, refMonth: number): string | null => {
      const m = DATE.exec(s);
      if (!m) return null;
      const probe = isoFromDayMon(s, 2000);
      if (!probe) return null;
      return isoFromDayMon(s, inferYear(Number(probe.slice(5, 7)), refYear, refMonth));
    };

    for (const page of doc.pages) {
      // A row's continuation lines never cross a page break; the next page opens with its own
      // headers ("Page n of m", the product and "(continued)" card lines).
      let rowOnThisPage = false;
      for (const line of page.lines) {
        if (done || line.y < FOOTER_Y) continue;
        const text = line.text;
        const first = line.items[0]!;

        if (/End of Transaction Details/.test(text)) {
          done = true;
          continue;
        }
        if (line.items.length === 1 && first.x < DESC_X && PRODUCT.test(text)) {
          pendingProduct = text;
          continue;
        }
        const card = line.items.length === 1 ? CARD.exec(text) : null;
        if (card && pendingProduct) {
          const last4 = lastFour(card[1]!)!;
          const holder = card[2]!.trim();
          const continued = /\(continued\)$/.test(text);
          if (continued && section && section.last4 === last4) {
            pendingProduct = null;
            continue;
          }
          const isPrincipal = due.has(last4) || !account || account.statement.account.product !== prettyProduct(pendingProduct);
          if (isPrincipal) {
            account = {
              statement: {
                account: { bank: 'UOB', product: prettyProduct(pendingProduct), kind: 'card', last4, currency: 'SGD', owner: 'me' },
                period: { start, end, month },
                openingCents: 0,
                closingCents: 0,
                printed: { amountDueCents: due.get(last4) },
                rows: [],
              },
              sections: [],
            };
            accounts.push(account);
          }
          section = { label: `${holder} ·${last4}`, holder, last4, openingCents: 0, cents: 0, rowIdx: [] };
          account!.sections.push(section);
          pendingProduct = null;
          continue;
        }
        pendingProduct = null;
        if (!account || !section) continue;

        const amount = lastAmount(line);
        if (/^PREVIOUS BALANCE\b/.test(text) && amount) {
          section.openingCents = amount.credit ? -amount.cents : amount.cents;
          account.statement.openingCents += section.openingCents;
          continue;
        }
        if (/^SUB TOTAL\b/.test(text) && amount) {
          section.cents = amount.credit ? -amount.cents : amount.cents;
          continue;
        }
        if (/^TOTAL BALANCE FOR /.test(text) && amount) {
          account.statement.closingCents = amount.credit ? -amount.cents : amount.cents;
          account.statement.printed.closingCents = account.statement.closingCents;
          section = null;
          continue;
        }

        const post = first.x < 90 ? rowDate(first.str, year, mon) : null;
        const second = line.items[1];
        if (post && second && amount) {
          const [py, pm] = post.split('-').map(Number) as [number, number];
          const trans = second.x < DESC_X ? rowDate(second.str, py, pm) : null;
          const desc = textBetween(line, DESC_X, line.items.at(-1)!.x - 1);
          account.statement.rows.push({
            date: trans ?? post,
            postDate: post,
            lines: desc ? [desc] : [],
            amountCents: amount.credit ? amount.cents : -amount.cents,
            cardholder: section.holder,
            cardLast4: section.last4,
          });
          section.rowIdx.push(account.statement.rows.length - 1);
          rowOnThisPage = true;
          continue;
        }
        const row = account.statement.rows.at(-1);
        if (!row || !rowOnThisPage || first.x < DESC_X || section.rowIdx.at(-1) !== account.statement.rows.length - 1) continue;
        if (/^Ref No\./.test(text)) continue;
        const fx = FX.exec(text);
        if (fx && fx[1] !== 'SGD') {
          const cents = amountOf(fx[2]!)?.cents;
          if (cents !== undefined) row.fx = { currency: fx[1]!, amountCents: cents };
          continue;
        }
        row.lines.push(text);
      }
    }

    return accounts.map(({ statement, sections }) => {
      statement.printed.subtotals = sections.map(({ label, openingCents, cents, rowIdx }) => ({ label, openingCents, cents, rowIdx }));
      if (statement.printed.amountDueCents === undefined) delete statement.printed.amountDueCents;
      return statement;
    });
  },
};
