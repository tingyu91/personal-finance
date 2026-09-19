import { describe, it, expect } from 'vitest';
import { dbsSavingsAdapter as adapter } from './dbs-savings';
import { dbsConsolidatedAdapter } from './dbs-consolidated';
import { docText } from './kit';
import { reconcile } from '../reconcile';
import { dbsSavings } from '../../test/fixtures/synthetic/dbs-savings';
import { dbsConsolidated } from '../../test/fixtures/synthetic/dbs-consolidated';

describe('DBS savings adapter', () => {
  it('detects its own layout and not the consolidated one', () => {
    expect(adapter.detect(docText(dbsSavings))).toBeGreaterThanOrEqual(0.9);
    expect(adapter.detect(docText(dbsConsolidated))).toBe(0);
    expect(dbsConsolidatedAdapter.detect(docText(dbsSavings))).toBe(0);
  });

  const [s] = adapter.parse(dbsSavings);

  it('reads the account and period', () => {
    expect(adapter.parse(dbsSavings)).toHaveLength(1);
    expect(s!.account).toEqual({ bank: 'DBS', product: 'Savings Account', kind: 'deposit', last4: '9876', currency: 'SGD', owner: 'me' });
    expect(s!.period).toEqual({ start: '2026-02-01', end: '2026-02-28', month: '2026-02' });
  });

  it('reads opening, closing and printed totals', () => {
    expect(s!.openingCents).toBe(2_000_00);
    expect(s!.closingCents).toBe(1_069_97);
    expect(s!.printed).toEqual({ debitsCents: 1_842_40, creditsCents: 912_37, closingCents: 1_069_97 });
  });

  it('reads rows across the page break with their continuation lines', () => {
    expect(s!.rows.map((r) => [r.date, r.amountCents, r.balanceCents ?? null])).toEqual([
      ['2026-02-01', -6_40, null],
      ['2026-02-01', -2_30, 1_991_30],
      ['2026-02-05', -23_10, 1_968_20],
      ['2026-02-15', 187_25, null],
      ['2026-02-15', -68_42, 2_087_03],
      ['2026-02-23', -1_742_18, 344_85],
      ['2026-02-25', 725_00, 1_069_85],
      ['2026-02-28', 12, 1_069_97],
    ]);
    expect(s!.rows[0]!.lines).toEqual(['Funds Transfer', 'TOP-UP TO PAYLAH! :', 'ALEX TAN', 'PLPE0000000000000001']);
    expect(s!.rows[6]!.lines).toEqual(['Quick Cheque Deposit']);
  });

  it('reconciles', () => {
    expect(reconcile(s!).ok).toBe(true);
  });
});
