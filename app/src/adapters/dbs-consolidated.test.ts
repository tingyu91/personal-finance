import { describe, it, expect } from 'vitest';
import { dbsConsolidatedAdapter as adapter } from './dbs-consolidated';
import { docText } from './kit';
import { reconcile } from '../reconcile';
import { dbsConsolidated } from '../../test/fixtures/synthetic/dbs-consolidated';
import { at, line } from '../../test/fixtures/pdf';

describe('DBS/POSB consolidated adapter', () => {
  it('detects its own layout', () => {
    expect(adapter.detect(docText(dbsConsolidated))).toBeGreaterThanOrEqual(0.9);
  });

  const [sgd, usd] = adapter.parse(dbsConsolidated);

  it('returns one statement per currency section', () => {
    expect(adapter.parse(dbsConsolidated)).toHaveLength(2);
    expect(sgd!.account).toEqual({ bank: 'DBS', product: 'My Account', kind: 'deposit', last4: '9871', currency: 'SGD', owner: 'joint' });
    expect(usd!.account.currency).toBe('USD');
    expect(sgd!.period).toEqual({ start: '2026-08-01', end: '2026-08-31', month: '2026-08' });
  });

  it('reads opening, closing and printed totals from the first carry and the total line', () => {
    expect(sgd!.openingCents).toBe(1_000_00);
    expect(sgd!.closingCents).toBe(1_713_28);
    expect(sgd!.printed).toEqual({ debitsCents: 1_548_72, creditsCents: 2_262_00, closingCents: 1_713_28 });
    expect(usd!.openingCents).toBe(100);
    expect(usd!.closingCents).toBe(100);
    expect(usd!.rows).toEqual([]);
  });

  it('reads rows with signs, balances and continuation lines, skipping carries and footers', () => {
    expect(sgd!.rows.map((r) => [r.date, r.amountCents, r.balanceCents])).toEqual([
      ['2026-08-01', -213_45, 786_55],
      ['2026-08-07', -17_00, 769_55],
      ['2026-08-19', 612_00, 1_381_55],
      ['2026-08-20', -1_318_27, 63_28],
      ['2026-08-28', 1_650_00, 1_713_28],
    ]);
    expect(sgd!.rows[1]!.lines).toEqual(['Advice FAST Payment / Receipt', 'PAYNOW TRANSFER 1234567', 'TO: JOHN DOE', 'PAYNOW TRANSFER', 'OTHER']);
    expect(sgd!.rows[4]!.lines).toEqual(['Advice FAST Payment / Receipt', 'OTHER', 'ABCD0102OCBCSGSGBRT5000002', 'OTHER']);
  });

  it('keeps the dated balance-only line as a checkpoint, not a row', () => {
    expect(sgd!.checkpoints).toEqual([{ afterRow: 4, balanceCents: 1_713_28 }]);
  });

  it('reconciles both sections', () => {
    expect(reconcile(sgd!).ok).toBe(true);
    expect(reconcile(usd!).ok).toBe(true);
  });

  it('continues a section when a continuation page repeats its CURRENCY line', () => {
    const d = structuredClone(dbsConsolidated);
    d.pages[2]!.lines.splice(2, 0, line(675, at(53, 'CURRENCY: SINGAPORE DOLLAR')));
    const parsed = adapter.parse(d);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.rows).toHaveLength(5);
    expect(reconcile(parsed[0]!).ok).toBe(true);
  });
});
