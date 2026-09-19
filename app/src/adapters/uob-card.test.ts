import { describe, it, expect } from 'vitest';
import { uobCardAdapter as adapter } from './uob-card';
import { uobOneAdapter } from './uob-one';
import { docText } from './kit';
import { reconcile } from '../reconcile';
import { uobCard } from '../../test/fixtures/synthetic/uob-card';
import { uobOne } from '../../test/fixtures/synthetic/uob-one';

describe('UOB credit card adapter', () => {
  it('detects its own layout and not the deposit one', () => {
    expect(adapter.detect(docText(uobCard))).toBeGreaterThanOrEqual(0.9);
    expect(adapter.detect(docText(uobOne))).toBe(0);
    expect(uobOneAdapter.detect(docText(uobCard))).toBe(0);
  });

  const [visa, kf] = adapter.parse(uobCard);

  it('returns one statement per principal card', () => {
    expect(adapter.parse(uobCard)).toHaveLength(2);
    expect(visa!.account).toEqual({ bank: 'UOB', product: 'Preferred Visa', kind: 'card', last4: '1111', currency: 'SGD', owner: 'me' });
    expect(kf!.account).toMatchObject({ product: 'KrisFlyer UOB Credit Card', last4: '3333' });
    expect(visa!.period).toEqual({ start: '2025-12-21', end: '2026-01-20', month: '2026-01' });
  });

  it('signs amounts from the household side and rolls December back a year', () => {
    expect(visa!.rows.map((r) => [r.postDate, r.date, r.amountCents])).toEqual([
      ['2025-12-22', '2025-12-22', 610_00],
      ['2025-12-23', '2025-12-21', -3_35],
      ['2026-01-02', '2025-12-30', -92_10],
      ['2026-01-05', '2026-01-04', -15_35],
      ['2026-01-07', '2026-01-05', -243_80],
      ['2026-01-08', '2026-01-06', 92_10],
      ['2026-01-15', '2026-01-14', -71_65],
    ]);
  });

  it('marks supplementary rows with their cardholder and card', () => {
    expect(visa!.rows[0]).toMatchObject({ cardholder: 'ALEX TAN', cardLast4: '1111' });
    expect(visa!.rows[1]).toMatchObject({ cardholder: 'SAM LEE', cardLast4: '2222' });
    expect(visa!.rows[6]).toMatchObject({ cardholder: 'SAM LEE', cardLast4: '2222' });
  });

  it('keeps descriptions, drops Ref No lines, and reads foreign amounts', () => {
    expect(visa!.rows[2]!.lines).toEqual(['LALAMOVE Singapore']); // last row before the page break
    expect(visa!.rows[3]!.lines).toEqual(['APPLE.COM/BILL 1234567890']);
    expect(visa!.rows[3]!.fx).toEqual({ currency: 'USD', amountCents: 11_37 });
    expect(visa!.rows[4]!.fx).toBeUndefined();
  });

  it('reads opening, closing, amount due and per-cardholder subtotals', () => {
    expect(visa!.openingCents).toBe(610_00);
    expect(visa!.closingCents).toBe(334_15);
    expect(visa!.printed.amountDueCents).toBe(334_15);
    expect(visa!.printed.closingCents).toBe(334_15);
    expect(visa!.printed.subtotals).toEqual([
      { label: 'ALEX TAN ·1111', openingCents: 610_00, cents: 0, rowIdx: [0] },
      { label: 'SAM LEE ·2222', openingCents: 0, cents: 334_15, rowIdx: [1, 2, 3, 4, 5, 6] },
    ]);
    expect(kf!.rows).toHaveLength(1);
    expect(kf!.closingCents).toBe(135_00);
  });

  it('reconciles both accounts', () => {
    expect(reconcile(visa!).ok).toBe(true);
    expect(reconcile(kf!).ok).toBe(true);
  });
});
