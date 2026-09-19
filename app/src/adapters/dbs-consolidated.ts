import { isoFromDmy, monthOf, parseDayMonYear } from '../core/dates';
import { lastFour } from '../core/redact';
import { amountOf, centsOf, findLine, headerColumns, nearestColumn, textBetween } from './kit';
import type { Adapter, ParsedStatement, PdfDoc, PdfLine } from './types';

/**
 * DBS/POSB consolidated statement (the joint account in the sample). Rows are dated
 * dd/mm/yyyy, descriptions run over several lines, and every row prints its balance.
 * Each account × currency section becomes one statement.
 */

type Col = 'debit' | 'credit' | 'balance';
const HEADER = { debit: /^Withdrawal/, credit: /^Deposit/, balance: /^Balance$/ };
const DESC_X = 100; // descriptions start at ~113; dates and footers sit left of this
const FOOTER_Y = 40; // page furniture (reg. numbers, page counts) sits below this

const CURRENCY_NAMES: Record<string, string> = {
  'SINGAPORE DOLLAR': 'SGD',
  'UNITED STATES DOLLAR': 'USD',
  'EURO': 'EUR',
  'STERLING POUND': 'GBP',
  'AUSTRALIAN DOLLAR': 'AUD',
  'JAPANESE YEN': 'JPY',
};

interface Section {
  statement: ParsedStatement;
  opened: boolean;
  closed: boolean;
}

function isJoint(doc: PdfDoc): boolean {
  const first = doc.pages[0];
  if (!first) return false;
  const summary = first.lines.find((l) => /^Account Summary/.test(l.text));
  return first.lines.some((l) => (!summary || l.y > summary.y) && /^[A-Z][A-Z .'-]+\/$/.test(l.text));
}

function amounts(line: PdfLine, cols: Record<Col, number>): Partial<Record<Col, number>> {
  const out: Partial<Record<Col, number>> = {};
  for (const item of line.items) {
    const a = amountOf(item.str) ?? (centsOf(item.str) !== null ? { cents: centsOf(item.str)!, credit: false } : null);
    if (!a) continue;
    const col = nearestColumn(item, cols);
    if (col) out[col] = a.cents;
  }
  return out;
}

function firstAmountX(line: PdfLine): number {
  const hit = line.items.find((i) => i.x >= DESC_X && (amountOf(i.str) || centsOf(i.str) !== null));
  return hit ? hit.x : Infinity;
}

export const dbsConsolidatedAdapter: Adapter = {
  id: 'dbs-consolidated',
  version: 1,
  bank: 'DBS',
  kind: 'consolidated',

  detect(text) {
    const hits = [/Consolidated Statement/, /Transaction Details/, /DBS/, /Withdrawal \(-\)/].filter((re) => re.test(text)).length;
    return hits === 4 ? 0.95 : 0;
  },

  parse(doc) {
    const asAt = findLine(doc, /^Transaction Details as at /)?.text.replace(/^Transaction Details as at /, '');
    const end = asAt ? parseDayMonYear(asAt) : null;
    if (!end) throw new Error('No "Transaction Details as at" date');
    const month = monthOf(end);
    const owner = isJoint(doc) ? 'joint' : 'me';

    const sections: Section[] = [];
    let product = '';
    let last4 = '';
    let cols: Record<Col, number> | null = null;
    let section: Section | null = null;
    let inTable = false;

    for (const page of doc.pages) {
      inTable = false;
      for (const line of page.lines) {
        if (line.y < FOOTER_Y) continue;
        const text = line.text;

        const acct = /^(.+?)\s+Account No\.?\s*([\d-]+)$/.exec(text);
        if (acct) {
          product = acct[1]!.trim();
          last4 = lastFour(acct[2]!) ?? '';
          continue;
        }
        const header = headerColumns(line, HEADER);
        if (header && /^Date/.test(text)) {
          cols = header;
          inTable = true;
          continue;
        }
        const cur = /^CURRENCY:\s+(.+)$/.exec(text);
        if (cur) {
          const currency = CURRENCY_NAMES[cur[1]!.trim()] ?? cur[1]!.trim().slice(0, 3).toUpperCase();
          // A continuation page may repeat the CURRENCY line of a section still open.
          const open = sections.find((s) => !s.closed && s.statement.account.last4 === last4 && s.statement.account.currency === currency);
          if (open) {
            section = open;
            inTable = true;
            continue;
          }
          section = {
            statement: {
              account: { bank: 'DBS', product, kind: 'deposit', last4, currency, owner },
              period: { start: `${month}-01`, end, month },
              openingCents: 0,
              closingCents: 0,
              printed: {},
              rows: [],
              checkpoints: [],
            },
            opened: false,
            closed: false,
          };
          sections.push(section);
          inTable = true;
          continue;
        }
        if (!section || section.closed || !cols || !inTable) continue;

        if (/^Balance Brought Forward/.test(text)) {
          const bbf = line.items.map((i) => centsOf(i.str)).find((c) => c !== null);
          if (!section.opened && bbf !== undefined && bbf !== null) {
            section.statement.openingCents = bbf;
            section.opened = true;
          }
          continue;
        }
        if (/^Balance Carried Forward/.test(text)) {
          inTable = false;
          continue;
        }
        const total = /^Total Balance Carried Forward in ([A-Z]{3}):/.exec(text);
        if (total) {
          const a = amounts(line, cols);
          const s = section.statement;
          s.printed = { debitsCents: a.debit ?? 0, creditsCents: a.credit ?? 0, closingCents: a.balance };
          s.closingCents = a.balance ?? s.openingCents + s.rows.reduce((t, r) => t + r.amountCents, 0);
          section.closed = true;
          continue;
        }

        const first = line.items[0]!;
        const date = first.x < DESC_X ? isoFromDmy(first.str) : null;
        if (date) {
          const a = amounts(line, cols);
          if (a.debit === undefined && a.credit === undefined) {
            if (a.balance !== undefined) {
              section.statement.checkpoints!.push({ afterRow: section.statement.rows.length - 1, balanceCents: a.balance });
            }
            continue;
          }
          const desc = textBetween(line, DESC_X, firstAmountX(line) - 1);
          section.statement.rows.push({
            date,
            lines: desc ? [desc] : [],
            amountCents: a.debit !== undefined ? -a.debit : a.credit!,
            balanceCents: a.balance,
          });
          continue;
        }
        const row = section.statement.rows.at(-1);
        if (row && first.x >= DESC_X && firstAmountX(line) === Infinity) {
          row.lines.push(text);
        }
      }
    }
    return sections.map((s) => s.statement);
  },
};
