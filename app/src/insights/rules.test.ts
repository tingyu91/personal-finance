import { describe, it, expect } from 'vitest';
import { defaultBenchmarks } from '../benchmarks';
import { DEFAULT_SETTINGS } from '../settings';
import {
  averageBalance,
  duplicates,
  fees,
  homeProjectWatch,
  idleCash,
  runRules,
  spendingSpike,
  staleData,
  subscriptions,
  taxYear,
  tieredInterestCents,
  uobOneBonus,
  unseenMoney,
  type SnapRow,
  type Snapshot,
} from './rules';

/** Invented figures and names only. */
let n = 0;
function row(over: Partial<SnapRow>): SnapRow {
  n++;
  return { fingerprint: `fp${n}`, date: '2026-08-01', accountId: 1, payee: 'Example', raw: 'Example', amountCents: -10_00, kind: 'spend', category: 'Other', bucket: null, targetAccountId: null, ...over };
}

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    today: '2026-09-19',
    months: ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'],
    rows: [],
    accounts: [{ id: 1, label: 'DBS Savings Account ·9876', kind: 'deposit', product: 'Savings Account', bank: 'DBS', seenOnly: false }],
    statements: [],
    coverage: { months: ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'], rows: [] },
    lastImport: '2026-09-10',
    home: null,
    settings: { ...DEFAULT_SETTINGS, partner: { name: 'Sam', aliases: ['SAM LEE'], refPatterns: [] } },
    benchmarks: defaultBenchmarks(),
    ...over,
  };
}

describe('1. unseen money', () => {
  it('acts when a card Tally cannot see gets S$500 or more a month, and links the repayments', () => {
    const repay = row({ kind: 'card-repayment', amountCents: -1_200_00, targetAccountId: 7 });
    const topup = row({ kind: 'wallet-topup', amountCents: -20_00 });
    const s = snap({
      rows: [repay, topup, row({ kind: 'card-repayment', amountCents: -50_00, targetAccountId: 1 })],
      coverage: {
        months: ['2026-07', '2026-08'],
        rows: [
          { account: 'Card ·5566', accountId: 7, seenOnly: true, cells: ['missing', 'missing'], unseenCents: [0, 1_200_00] },
          { account: 'DBS PayLah', accountId: null, seenOnly: true, cells: ['missing', 'missing'], unseenCents: [0, 20_00] },
        ],
      },
    });
    const [i] = unseenMoney(s);
    expect(i).toMatchObject({ rule: 1, level: 'act', title: 'S$1,220.00 went to cards and wallets Tally cannot see into' });
    expect(i!.detail).toContain('About S$610.00 a month over 2 months.');
    expect(i!.detail).toContain('Card ·5566 S$1,200.00, DBS PayLah S$20.00');
    expect(i!.fingerprints.sort()).toEqual([repay.fingerprint, topup.fingerprint].sort());
  });

  it('only watches below the threshold, and is quiet with nothing unseen', () => {
    const s = snap({ coverage: { months: ['2026-08'], rows: [{ account: 'DBS PayLah', accountId: null, seenOnly: true, cells: ['missing'], unseenCents: [30_00] }] } });
    expect(unseenMoney(s)[0]!.level).toBe('watch');
    expect(unseenMoney(snap())).toEqual([]);
  });

  it('averages over every month with statements, so one large repayment does not read as a monthly habit', () => {
    const cells = ['missing', 'missing', 'missing', 'missing', 'missing', 'missing', 'missing'];
    const s = snap({
      coverage: {
        months: ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'],
        rows: [{ account: 'Card ·5566', accountId: 7, seenOnly: true, cells, unseenCents: [0, 0, 0, 2_100_00, 0, 0, 0] }],
      },
    });
    const [i] = unseenMoney(s);
    expect(i!.level).toBe('watch');
    expect(i!.detail).toContain('About S$300.00 a month over 7 months.');
  });
});

describe('2. UOB One bonus interest', () => {
  const one = { id: 2, label: 'UOB One Account ·5555', kind: 'deposit', product: 'One Account', bank: 'UOB', seenOnly: false };
  const statement = (month: string, spend: number, balance: number) => ({
    accountId: 2,
    month,
    periodStart: `${month}-01`,
    periodEnd: `${month}-30`,
    openingCents: balance,
    closingCents: balance,
    meta: { creditCardEligibleSpendCents: spend, debitCardEligibleSpendCents: 0 },
    balances: [],
  });

  const salary = (date: string) => row({ accountId: 2, date, raw: 'Inward CR - GIRO · SALA Salary Payment', amountCents: 5_000_00, kind: 'income' });

  it('works out tiered interest a year', () => {
    const tiers = defaultBenchmarks().uobOne.salaryTiers;
    expect(tieredInterestCents(150_000_00, tiers)).toBe(2_850_00);
    expect(tieredInterestCents(50_000_00, tiers)).toBe(500_00);
  });

  it('averages end-of-day balances over the period', () => {
    expect(averageBalance({ ...statement('2026-06', 0, 100_00), balances: [{ date: '2026-06-16', cents: 400_00 }] })).toBe(250_00);
    // A part period: ten days at S$100, then five at S$400.
    expect(averageBalance({ ...statement('2026-06', 0, 100_00), periodEnd: '2026-06-15', balances: [{ date: '2026-06-11', cents: 400_00 }] })).toBe(200_00);
  });

  it('says so when eligible spend was below the minimum and no bonus came, with the worth at your balance', () => {
    const s = snap({
      accounts: [one],
      rows: [salary('2026-07-25'), salary('2026-08-25')],
      statements: [statement('2026-07', 120_00, 150_000_00), statement('2026-08', 310_00, 150_000_00)],
    });
    const [i] = uobOneBonus(s);
    expect(i).toMatchObject({ rule: 2, level: 'act', title: 'UOB One Account ·5555 paid no bonus interest in 2 of 2 months with a salary credit', checkedOn: '2026-09-19' });
    expect(i!.detail).toContain('Eligible card spend was S$120.00 to S$310.00 a month, below the S$500.00 UOB lists.');
    expect(i!.detail).toContain('Checked 2026-09-19.');
    expect(i!.worthCents).toBe(2_850_00 - 75_00);
  });

  it('is quiet for months without a salary credit, and counts only the months with one', () => {
    expect(uobOneBonus(snap({ accounts: [one], statements: [statement('2026-08', 100_00, 150_000_00)] }))).toEqual([]);
    const s = snap({ accounts: [one], rows: [salary('2026-08-25')], statements: [statement('2026-07', 100_00, 150_000_00), statement('2026-08', 100_00, 150_000_00)] });
    expect(uobOneBonus(s)[0]!.title).toBe('UOB One Account ·5555 paid no bonus interest in 1 of 1 months with a salary credit');
  });

  it('looks for the salary in the month UOB printed the spend for', () => {
    const lagged = { ...statement('2026-08', 100_00, 150_000_00), meta: { creditCardEligibleSpendCents: 100_00, eligibleSpendMonth: '2026-07' } };
    expect(uobOneBonus(snap({ accounts: [one], rows: [salary('2026-07-25')], statements: [lagged] }))).toHaveLength(1);
    expect(uobOneBonus(snap({ accounts: [one], rows: [salary('2026-08-25')], statements: [lagged] }))).toEqual([]);
  });

  it('turns Watch when the UOB figures were checked over 180 days ago', () => {
    const s = snap({ today: '2027-06-01', accounts: [one], rows: [salary('2026-08-25')], statements: [statement('2026-08', 100_00, 150_000_00)] });
    const [i] = uobOneBonus(s);
    expect(i!.level).toBe('watch');
    expect(i!.detail).toContain('over six months ago');
  });

  it('is quiet when the spend was met or a bonus was paid', () => {
    const met = { ...statement('2026-08', 600_00, 50_000_00) };
    const paid = { ...statement('2026-07', 100_00, 50_000_00), meta: { creditCardEligibleSpendCents: 100_00, bonusInterestCents: 12_00 } };
    expect(uobOneBonus(snap({ accounts: [one], rows: [salary('2026-07-25'), salary('2026-08-25')], statements: [met, paid] }))).toEqual([]);
  });
});

describe('3. possible duplicates', () => {
  it('pairs the same payee and amount within 14 days', () => {
    const a = row({ payee: 'Shoplink Transaction', amountCents: -1_234_50, date: '2026-05-02', kind: 'unclassified' });
    const b = row({ payee: 'Shoplink Transaction', amountCents: -1_234_50, date: '2026-05-10', kind: 'unclassified' });
    const [i] = duplicates(snap({ rows: [a, b] }));
    expect(i).toMatchObject({ rule: 3, level: 'watch', title: 'Two payments of S$1,234.50 to Shoplink Transaction, 8 days apart', worthCents: 1_234_50 });
    expect(i!.fingerprints.sort()).toEqual([a.fingerprint, b.fingerprint].sort());
    expect(i!.action!.href).toBe(`#/transactions?insight=${encodeURIComponent(i!.key)}`);
  });

  it('leaves out a series: the same payee and amount three or more times', () => {
    const rows = ['2026-05-02', '2026-05-09', '2026-05-16'].map((date) => row({ payee: 'Weekly Helper', amountCents: -150_00, date, kind: 'unclassified' }));
    expect(duplicates(snap({ rows }))).toEqual([]);
    expect(duplicates(snap({ rows: rows.slice(0, 2) }))).toHaveLength(1);
  });

  it('still flags a pair when the only other identical payment was months earlier', () => {
    const rows = ['2026-01-10', '2026-05-02', '2026-05-10'].map((date) => row({ payee: 'Example Aircon', amountCents: -180_00, date, kind: 'spend' }));
    const [i] = duplicates(snap({ rows }));
    expect(i!.fingerprints.sort()).toEqual([rows[1]!.fingerprint, rows[2]!.fingerprint].sort());
  });

  it('ignores small amounts, other payees, and pairs more than 14 days apart', () => {
    const rows = [
      row({ payee: 'Bus/MRT', amountCents: -1_99, date: '2026-05-02' }),
      row({ payee: 'Bus/MRT', amountCents: -1_99, date: '2026-05-03' }),
      row({ payee: 'A', amountCents: -300_00, date: '2026-05-02' }),
      row({ payee: 'B', amountCents: -300_00, date: '2026-05-03' }),
      row({ payee: 'C', amountCents: -300_00, date: '2026-05-02' }),
      row({ payee: 'C', amountCents: -300_00, date: '2026-05-20' }),
      row({ payee: 'D', amountCents: -300_00, date: '2026-05-02', kind: 'transfer' }),
      row({ payee: 'D', amountCents: -300_00, date: '2026-05-03', kind: 'transfer' }),
    ];
    expect(duplicates(snap({ rows }))).toEqual([]);
  });
});

describe('4. fees', () => {
  it('adds up fee rows and fee lines, annualised, and never counts the cashier’s order', () => {
    const annual = row({ kind: 'fee', payee: 'Card membership fee', raw: 'CARD MEMBERSHIP FEE', amountCents: -150_45 });
    const late = row({ kind: 'spend', payee: 'Late charge', raw: 'LATE CHARGE', amountCents: -100_00 });
    const co = row({ kind: 'spend', category: 'Home project', payee: 'Cashier’s order', raw: 'Misc Debit · DR CO CHARGES', amountCents: -400_000_00 });
    const [i] = fees(snap({ rows: [annual, late, co] }));
    expect(i).toMatchObject({ rule: 4, level: 'watch', title: 'S$250.45 in bank and card fees across 6 months', worthCents: 500_90 });
    expect(i!.fingerprints).toEqual([annual.fingerprint, late.fingerprint]);
    expect(fees(snap({ rows: [co] }))).toEqual([]);
  });
});

describe('5. subscriptions', () => {
  it('finds a monthly charge over three months, and names a new one and a price change', () => {
    const monthly = (payee: string, amounts: number[], from = 3) =>
      amounts.map((a, k) => row({ payee, amountCents: -a, date: `2026-0${from + k}-05` }));
    const tax = [3, 4, 5, 6, 7, 8].map((m) => row({ payee: 'IRAS property tax', category: 'Home running', amountCents: -500_00, date: `2026-0${m}-15` }));
    const rows = [...monthly('Streamly', [15_98, 15_98, 15_98, 15_98, 15_98, 17_98]), ...monthly('Cloudbox', [3_98, 3_98, 3_98], 6), ...monthly('Gym', [80_00, 80_00], 7), ...tax];
    const [i] = subscriptions(snap({ rows }));
    expect(i).toMatchObject({ rule: 5, level: 'info', title: '2 regular monthly charges, about S$21.96 a month', worthCents: 21_96 * 12 });
    expect(i!.detail).toContain('Cloudbox is new');
    expect(i!.detail).toContain('Streamly changed price');
    expect(i!.detail).not.toContain('Gym');
    expect(i!.detail).not.toContain('IRAS');
  });

  it('is quiet about a charge that stopped', () => {
    const rows = ['03', '04', '05', '06'].map((m) => row({ payee: 'Streamly', amountCents: -15_98, date: `2026-${m}-05` }));
    expect(subscriptions(snap({ rows }))).toEqual([]);
  });
});

describe('6. spending spike', () => {
  it('watches a category at 1.5 times its six-month median, leaving out the home project', () => {
    const rows = [
      ...['03', '04', '05', '06', '07'].map((m) => row({ category: 'Transport', amountCents: -100_00, date: `2026-${m}-10` })),
      row({ category: 'Transport', amountCents: -180_00, date: '2026-08-10' }),
      ...['03', '04', '05', '06', '07'].map((m) => row({ category: 'Home project', amountCents: -10_00, date: `2026-${m}-10` })),
      row({ category: 'Home project', amountCents: -9_000_00, date: '2026-08-10' }),
    ];
    const out = spendingSpike(snap({ rows }));
    expect(out.map((i) => i.title)).toEqual(['Transport was S$180.00 in August 2026, 1.8 times the usual']);
    expect(out[0]!.action!.href).toBe('#/transactions?month=2026-08&category=Transport');
    expect(out[0]!.detail).not.toContain('may be low');
  });

  const transport = () => [...['05', '06', '07'].map((m) => row({ category: 'Transport', amountCents: -100_00, date: `2026-${m}-10` })), row({ category: 'Transport', amountCents: -180_00, date: '2026-08-10' })];

  it('is quiet with fewer than three months before', () => {
    expect(spendingSpike(snap({ months: ['2026-06', '2026-07', '2026-08'], rows: transport() }))).toEqual([]);
  });

  it('says both figures may be low when a month is missing statements or has unseen money', () => {
    const coverage = { months: ['2026-07', '2026-08'], rows: [{ account: 'Card ·5566', accountId: 7, seenOnly: true, cells: ['missing' as const, 'missing' as const], unseenCents: [0, 0] }] };
    const [i] = spendingSpike(snap({ rows: transport(), coverage }));
    expect(i!.detail).toContain('Some of these months have statements missing or money Tally cannot see, so both figures may be low.');
  });
});

describe('7. idle cash', () => {
  it('states the cash above N months of spending as a fact', () => {
    const rows = ['03', '04', '05', '06', '07', '08'].map((m) => row({ amountCents: -1_000_00, date: `2026-${m}-10` }));
    rows.push(row({ kind: 'income', category: 'Interest', amountCents: 1_20, date: '2026-08-31' }));
    const statements = [{ accountId: 1, month: '2026-08', periodStart: '2026-08-01', periodEnd: '2026-08-31', openingCents: 0, closingCents: 20_000_00, meta: {}, balances: [] }];
    const [i] = idleCash(snap({ rows, statements }));
    expect(i).toMatchObject({ rule: 7, level: 'info', title: 'S$14,000.00 sits above 6 months of spending' });
    expect(i!.detail).toContain('This is a fact, not advice.');
    expect(idleCash(snap({ rows, statements: [{ ...statements[0]!, closingCents: 5_000_00 }] }))).toEqual([]);
  });
});

describe('8. tax-year moves', () => {
  it('is quiet before October, Info in October, and Act in November and December', () => {
    expect(taxYear(snap())).toEqual([]);
    expect(taxYear(snap({ today: '2026-10-05' }))[0]!.level).toBe('info');
    expect(taxYear(snap({ today: '2026-10-05', months: [] }))).toEqual([]);
    const [i] = taxYear(snap({ today: '2026-11-20', rows: [row({ raw: 'SRS CONTRIBUTION', amountCents: -5_000_00, date: '2026-03-01' })] }));
    expect(i).toMatchObject({ rule: 8, level: 'act', title: 'Tax relief for 2026 closes on 31 December' });
    expect(i!.detail).toContain('(S$5,000.00 seen this year)');
    expect(i!.detail).toContain('Set your marginal tax rate');
    expect(i!.worthCents).toBeUndefined();
  });

  it('values the unused room at your marginal rate when you have set one', () => {
    const s = snap({ today: '2026-12-01', settings: { ...DEFAULT_SETTINGS, marginalTaxRate: 0.115 } });
    expect(taxYear(s)[0]!.worthCents).toBe(Math.round((15_300_00 + 8_000_00) * 0.115));
  });
});

describe('9. home project', () => {
  it('notes balances outstanding, budget burn and payments after handover', () => {
    const late = { fingerprint: 'late', date: '2026-10-02' };
    const out = homeProjectWatch(
      snap({ home: { budgetCents: 50_000_00, totalCents: 45_000_00, endMonth: '2026-09', vendors: [{ name: 'Example Reno', balanceCents: 2_000_00 }, { name: 'IKEA', balanceCents: null }], rows: [late] } }),
    );
    expect(out.map((i) => i.title)).toEqual([
      'S$2,000.00 is still to pay on home contracts',
      'The home has used 90% of its S$50,000 budget',
      '1 home payment after the project ended',
    ]);
    expect(out[2]!.fingerprints).toEqual(['late']);
    expect(homeProjectWatch(snap())).toEqual([]);
  });
});

describe('10. stale data', () => {
  it('watches for no import in 35 days and for a missing month of a known account', () => {
    const out = staleData(
      snap({
        lastImport: '2026-08-01',
        coverage: { months: ['2026-06', '2026-07', '2026-08'], rows: [{ account: 'DBS Savings Account ·9876', accountId: 1, seenOnly: false, cells: ['ok', 'missing', 'ok'], unseenCents: [0, 0, 0] }] },
      }),
    );
    expect(out.map((i) => i.title)).toEqual(['Nothing imported for 49 days', 'DBS Savings Account ·9876 has no statement for July 2026']);
    expect(staleData(snap())).toEqual([]);
  });

  it('keeps a gap’s key as later months go missing too, so dismissing it sticks', () => {
    const gap = (cells: ('ok' | 'missing')[], months: string[]) =>
      staleData(snap({ coverage: { months, rows: [{ account: 'DBS Savings Account ·9876', accountId: 1, seenOnly: false, cells, unseenCents: months.map(() => 0) }] } }))[0]!.key;
    expect(gap(['ok', 'missing'], ['2026-07', '2026-08'])).toBe(gap(['ok', 'missing', 'missing'], ['2026-07', '2026-08', '2026-09']));
  });
});

describe('runRules', () => {
  it('orders Act before Watch before Info', () => {
    const s = snap({
      today: '2026-10-05',
      coverage: { months: ['2026-08'], rows: [{ account: 'Card ·5566', accountId: 7, seenOnly: true, cells: ['missing'], unseenCents: [900_00] }] },
      rows: [row({ kind: 'fee', raw: 'ANNUAL FEE', amountCents: -100_00 })],
    });
    expect(runRules(s).map((i) => i.level)).toEqual(['act', 'watch', 'info']);
  });
});
