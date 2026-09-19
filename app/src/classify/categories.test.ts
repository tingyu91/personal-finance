import { describe, it, expect } from 'vitest';
import { CATEGORIES, INCOME_CATEGORIES, KINDS, SPENDING_KINDS, isCategory, isKind, slotOf } from './categories';

describe('categories and kinds', () => {
  it('keeps the eight chart slots in their fixed order, with Other as slot 0', () => {
    expect(CATEGORIES.map((c) => [c.slot, c.name])).toEqual([
      [1, 'Food & groceries'],
      [2, 'Transport'],
      [3, 'Home running'],
      [4, 'Home project'],
      [5, 'Health & personal care'],
      [6, 'Shopping & subscriptions'],
      [7, 'Travel & leisure'],
      [8, 'Family & giving'],
      [0, 'Other'],
    ]);
    expect(slotOf('Transport')).toBe(2);
    expect(slotOf('Other')).toBe(0);
    expect(slotOf('Something new')).toBe(0);
    expect(slotOf(null)).toBe(0);
  });

  it('lists every kind, and only spend, fee and tax count as spending', () => {
    expect(KINDS).toEqual([
      'spend',
      'income',
      'transfer',
      'card-repayment',
      'investment',
      'wallet-topup',
      'refund',
      'fee',
      'tax',
      'partner-contribution',
      'unclassified',
    ]);
    expect(SPENDING_KINDS).toEqual(['spend', 'fee', 'tax']);
  });

  it('validates names', () => {
    expect(isKind('refund')).toBe(true);
    expect(isKind('gift')).toBe(false);
    expect(isCategory('Home project')).toBe(true);
    expect(isCategory('Salary')).toBe(true);
    expect(isCategory('Groceries')).toBe(false);
    expect(INCOME_CATEGORIES).toEqual(['Salary', 'Interest', 'Other income']);
  });
});
