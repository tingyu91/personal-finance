import { describe, it, expect } from 'vitest';
import { reconcile } from './reconcile';
import type { ParsedStatement } from './adapters/types';

const deposit = (over: Partial<ParsedStatement> = {}): ParsedStatement => ({
  account: { bank: 'DBS', product: 'Savings Account', kind: 'deposit', last4: '9876', currency: 'SGD', owner: 'me' },
  period: { start: '2026-02-01', end: '2026-02-28', month: '2026-02' },
  openingCents: 100_00,
  closingCents: 130_00,
  printed: { debitsCents: 20_00, creditsCents: 50_00, closingCents: 130_00 },
  rows: [
    { date: '2026-02-01', lines: ['Funds Transfer'], amountCents: -20_00, balanceCents: 80_00 },
    { date: '2026-02-03', lines: ['FAST Payment / Receipt'], amountCents: 50_00 },
  ],
  checkpoints: [{ afterRow: 1, balanceCents: 130_00 }],
  ...over,
});

describe('reconcile — deposit', () => {
  it('passes when totals, balances and checkpoints agree', () => {
    const r = reconcile(deposit());
    expect(r.ok).toBe(true);
    expect(r.checks.map((c) => c.name)).toEqual([
      'Withdrawals match the printed total',
      'Deposits match the printed total',
      'Opening plus rows equals closing',
      'Closing matches the printed closing',
      'Running balances match',
      'Printed closing balance found',
    ]);
  });

  it('fails when the statement’s own closing balance was never found', () => {
    const r = reconcile(deposit({ printed: { debitsCents: 20_00, creditsCents: 50_00 } }));
    expect(r.checks.at(-1)).toMatchObject({ name: 'Printed closing balance found', ok: false });
  });

  it('fails on a wrong running balance and says which check', () => {
    const s = deposit();
    s.rows[0]!.balanceCents = 81_00;
    const r = reconcile(s);
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => !c.ok)?.name).toBe('Running balances match');
  });

  it('fails when the printed withdrawals disagree', () => {
    const r = reconcile(deposit({ printed: { debitsCents: 21_00, creditsCents: 50_00 } }));
    expect(r.ok).toBe(false);
    expect(r.checks[0]).toMatchObject({ ok: false, expected: 21_00, actual: 20_00 });
  });

  it('accepts an empty statement whose opening equals its closing', () => {
    const r = reconcile(deposit({ rows: [], openingCents: 100, closingCents: 100, printed: { debitsCents: 0, creditsCents: 0, closingCents: 100 }, checkpoints: [] }));
    expect(r.ok).toBe(true);
  });
});

describe('reconcile — card', () => {
  const card: ParsedStatement = {
    account: { bank: 'UOB', product: 'Preferred Visa', kind: 'card', last4: '1111', currency: 'SGD', owner: 'me' },
    period: { start: '2026-07-21', end: '2026-08-20', month: '2026-08' },
    openingCents: 610_00,
    closingCents: 334_05,
    printed: {
      closingCents: 334_05,
      amountDueCents: 334_05,
      subtotals: [
        { label: 'ALEX TAN', openingCents: 610_00, cents: 0, rowIdx: [0] },
        { label: 'SAM LEE', openingCents: 0, cents: 334_05, rowIdx: [1, 2] },
      ],
    },
    rows: [
      { date: '2026-07-22', lines: ['PAYMENT'], amountCents: 610_00 },
      { date: '2026-08-09', lines: ['SHOP'], amountCents: -411_15 },
      { date: '2026-08-11', lines: ['SHOP REFUND'], amountCents: 77_10 },
    ],
  };

  it('treats spending as raising what is owed', () => {
    const r = reconcile(card);
    expect(r.ok).toBe(true);
    expect(r.checks.map((c) => c.name)).toEqual([
      'Opening plus charges less credits equals closing',
      'Closing matches the amount to pay',
      'Subtotal for ALEX TAN',
      'Subtotal for SAM LEE',
      'Printed total balance found',
    ]);
  });

  it('fails when no total balance line was read', () => {
    const noTotal = structuredClone(card);
    delete noTotal.printed.closingCents;
    expect(reconcile(noTotal).checks.at(-1)).toMatchObject({ name: 'Printed total balance found', ok: false });
  });

  it('fails when a subtotal disagrees', () => {
    const bad = structuredClone(card);
    bad.printed.subtotals![1]!.cents = 334_06;
    expect(reconcile(bad).ok).toBe(false);
  });
});
