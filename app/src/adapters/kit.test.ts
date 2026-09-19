import { describe, it, expect } from 'vitest';
import { amountOf, headerColumns, isAmount, nearestColumn } from './kit';
import type { PdfLine } from './types';

const it_ = (str: string, x: number, w: number) => ({ str, x, y: 600, w, r: x + w });

describe('adapter kit', () => {
  it('recognises statement amounts, with or without CR', () => {
    expect(isAmount('1,234.56')).toBe(true);
    expect(isAmount('432.10 CR')).toBe(true);
    expect(isAmount('SGD 2,345.67')).toBe(false);
    expect(amountOf('432.10 CR')).toEqual({ cents: 43210, credit: true });
    expect(amountOf('6.13')).toEqual({ cents: 613, credit: false });
    expect(amountOf('x')).toBeNull();
  });

  it('reads column right edges from a header line', () => {
    const line: PdfLine = {
      y: 604,
      text: 'Date Description Withdrawal (-) Deposit (+) Balance',
      items: [it_('Date', 45, 20), it_('Description', 113, 50), it_('Withdrawal (-)', 338, 59.5), it_('Deposit (+)', 429.7, 46.8), it_('Balance', 515.4, 34.5)],
    };
    const cols = headerColumns(line, { debit: /^Withdrawal/, credit: /^Deposit/, balance: /^Balance/ });
    expect(cols).toEqual({ debit: 397.5, credit: 476.5, balance: 549.9 });
  });

  it('assigns an amount to the nearest column right edge', () => {
    const cols = { debit: 397, credit: 476, balance: 550 };
    expect(nearestColumn({ r: 395 }, cols)).toBe('debit');
    expect(nearestColumn({ r: 474 }, cols)).toBe('credit');
    expect(nearestColumn({ r: 548 }, cols)).toBe('balance');
    expect(nearestColumn({ r: 300 }, cols)).toBeNull();
  });
});
