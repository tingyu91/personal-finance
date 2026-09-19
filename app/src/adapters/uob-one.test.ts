import { describe, it, expect } from 'vitest';
import { uobOneAdapter as adapter } from './uob-one';
import { docText } from './kit';
import { reconcile } from '../reconcile';
import { uobOne } from '../../test/fixtures/synthetic/uob-one';
import { at, line } from '../../test/fixtures/pdf';
import { dbsSavings } from '../../test/fixtures/synthetic/dbs-savings';
import { dbsConsolidated } from '../../test/fixtures/synthetic/dbs-consolidated';

describe('UOB One Account adapter', () => {
  it('detects its own layout only', () => {
    expect(adapter.detect(docText(uobOne))).toBeGreaterThanOrEqual(0.9);
    expect(adapter.detect(docText(dbsSavings))).toBe(0);
    expect(adapter.detect(docText(dbsConsolidated))).toBe(0);
  });

  const [s] = adapter.parse(uobOne);

  it('reads the account and period from the contents', () => {
    expect(adapter.parse(uobOne)).toHaveLength(1);
    expect(s!.account).toEqual({ bank: 'UOB', product: 'One Account', kind: 'deposit', last4: '5555', currency: 'SGD', owner: 'me' });
    expect(s!.period).toEqual({ start: '2026-07-01', end: '2026-07-31', month: '2026-07' });
  });

  it('takes the opening from BALANCE B/F and the totals from the Total line', () => {
    expect(s!.openingCents).toBe(38_500_25);
    expect(s!.closingCents).toBe(30_212_22);
    expect(s!.printed).toEqual({ debitsCents: 16_689_40, creditsCents: 8_401_37, closingCents: 30_212_22 });
  });

  it('reads rows across pages, each with its balance', () => {
    expect(s!.rows.map((r) => [r.date, r.amountCents, r.balanceCents])).toEqual([
      ['2026-07-03', -15_000_00, 23_500_25],
      ['2026-07-06', -689_40, 22_810_85],
      ['2026-07-14', -250_00, 22_560_85],
      ['2026-07-16', 8_400_00, 30_960_85],
      ['2026-07-20', -750_00, 30_210_85],
      ['2026-07-31', 1_37, 30_212_22],
    ]);
    expect(s!.rows[1]!.lines).toEqual(['Inward DR - GIRO', 'PTXP S1234567D', 'IRAS', '7654321N']);
  });

  it('keeps the bank’s own bonus-interest figures as meta', () => {
    expect(s!.meta).toEqual({
      creditCardEligibleSpendCents: 164_20,
      debitCardEligibleSpendCents: 0,
      bonusInterestCents: null,
      eligibleSpendMonth: '2026-06',
      interestEarnedYtdCents: 21_46,
    });
  });

  it('reconciles', () => {
    expect(reconcile(s!).ok).toBe(true);
  });

  it('does not add text printed after the Total line to the last row', () => {
    const d = structuredClone(uobOne);
    const p = d.pages[2]!;
    p.lines.push(line(585, at(120.5, 'Footnote about interest rates')));
    p.lines.sort((a, b) => b.y - a.y);
    const [again] = adapter.parse(d);
    expect(again!.rows.at(-1)!.lines).toEqual(['Interest Credit']);
  });
});
