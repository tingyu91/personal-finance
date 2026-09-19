import fs from 'node:fs';
import path from 'node:path';
import type { Paths } from '../config';
import type { HomeData } from './home';

const BOM = '﻿';
const CRLF = '\r\n';

/** A text cell: always quoted; a leading =, +, - or @ is defused so Excel never runs it as a formula. */
function textCell(v: string | null): string {
  let s = v ?? '';
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** A number cell: plain digits with two decimals, so Excel reads it as a number. */
function amountCell(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

const HEADER = ['Date', 'Payee', 'Vendor', 'Bucket', 'Paid by', 'Account', 'Amount (SGD)', 'Note', 'Statement text'];

/** The home project's rows as CSV for Excel: UTF-8 with a BOM, CRLF line ends, ISO dates. */
export function homeCsv(data: HomeData, payerLabel: (p: HomeData['rows'][number]['payer']) => string): string {
  const lines = [HEADER.map(textCell).join(',')];
  for (const r of data.rows) {
    lines.push(
      [
        r.date,
        textCell(r.payee),
        textCell(r.vendor),
        textCell(r.bucket ?? 'Needs a bucket'),
        textCell(payerLabel(r.payer)),
        textCell(r.account),
        amountCell(r.cents),
        textCell(r.note),
        textCell(r.raw),
      ].join(','),
    );
  }
  return BOM + lines.join(CRLF) + CRLF;
}

/** Writes the export to outputs/exports and returns its path. */
export function writeHomeCsv(paths: Paths, csv: string, today: string): string {
  fs.mkdirSync(paths.exportsDir, { recursive: true });
  const file = path.join(paths.exportsDir, `home-project-${today}.csv`);
  fs.writeFileSync(file, csv, 'utf8');
  return file;
}
