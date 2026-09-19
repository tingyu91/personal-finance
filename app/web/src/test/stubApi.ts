import { vi } from 'vitest';
import type { Api, HomeData } from '../api';

/** An invented home project: EXAMPLE RENO, Sofa House, one row with no bucket. */
export function homeData(over: Partial<HomeData> = {}): HomeData {
  return {
    project: { id: 1, name: 'Home', startMonth: '2026-02', startSet: false, endMonth: null, budgetCents: 10_000_00 },
    partnerName: 'Sam',
    payerLabels: { me: 'You', joint: 'Joint account', partner: 'Sam’s cards' },
    totalCents: 4_580_00,
    buckets: [
      { bucket: 'renovation', cents: 4_000_00, count: 2 },
      { bucket: 'furnishing', cents: 500_00, count: 1 },
      { bucket: null, cents: 80_00, count: 1 },
    ],
    vendors: [
      { id: 1, name: 'Example Reno', match: 'example reno', contractCents: 5_000_00, paidCents: 4_000_00, balanceCents: 1_000_00, lastPaid: '2026-03-02', count: 2 },
      { id: null, name: 'Sofa House', match: null, contractCents: null, paidCents: 500_00, balanceCents: null, lastPaid: '2026-04-10', count: 1 },
      { id: null, name: 'Hardware shop', match: null, contractCents: null, paidCents: 80_00, balanceCents: null, lastPaid: '2026-03-09', count: 1 },
    ],
    payers: [
      { payer: 'me', label: 'You', cents: 4_080_00 },
      { payer: 'partner', label: 'Sam’s cards', cents: 500_00 },
    ],
    contributions: [
      { fingerprint: 'c1', date: '2026-03-01', purpose: 'Sam Lee Reno', cents: 1_500_00, account: 'DBS My Account ·9871', suggestedVendor: 'Example Reno', homeLike: true },
      { fingerprint: 'c2', date: '2026-03-05', purpose: 'Sam Grab', cents: 40_00, account: 'DBS My Account ·9871', suggestedVendor: null, homeLike: false },
    ],
    contributionsCents: 1_540_00,
    homeLikeContributionsCents: 1_500_00,
    cumulative: [
      { month: '2026-02', cents: 0 },
      { month: '2026-03', cents: 4_080_00 },
      { month: '2026-04', cents: 4_580_00 },
    ],
    unseen: { cents: 2_400_00, accounts: [{ account: 'Card ·5566', cents: 2_400_00 }] },
    unsortedLarge: { count: 2, cents: 3_100_00 },
    rows: [
      { fingerprint: 'r1', date: '2026-03-02', payee: 'EXAMPLE RENO', vendor: 'Example Reno', vendorId: 1, bucket: 'renovation', payer: 'me', account: 'Manual entry', cents: 2_000_00, note: null, raw: 'Manual entry' },
      { fingerprint: 'r2', date: '2026-03-20', payee: 'EXAMPLE RENO', vendor: 'Example Reno', vendorId: 1, bucket: 'renovation', payer: 'me', account: 'DBS My Account ·9871', cents: 2_000_00, note: null, raw: 'PAYNOW-FAST · EXAMPLE RENO' },
      { fingerprint: 'r3', date: '2026-03-09', payee: 'Hardware shop', vendor: 'Hardware shop', vendorId: null, bucket: null, payer: 'me', account: 'Manual entry', cents: 80_00, note: null, raw: 'Manual entry' },
      { fingerprint: 'r4', date: '2026-04-10', payee: 'Sofa House', vendor: 'Sofa House', vendorId: null, bucket: 'furnishing', payer: 'partner', account: 'UOB Preferred Visa ·1111', cents: 500_00, note: null, raw: 'SOFA HOUSE SINGAPORE' },
    ],
    ...over,
  };
}

/** A stub API with invented data for screen tests. Override any method per test. */
export function stubApi(over: Partial<Record<keyof Api, unknown>> = {}): Api {
  const base = {
    meta: vi.fn(async () => ({
      categories: [
        { name: 'Food & groceries', slot: 1 },
        { name: 'Transport', slot: 2 },
        { name: 'Home running', slot: 3 },
        { name: 'Home project', slot: 4 },
        { name: 'Health & personal care', slot: 5 },
        { name: 'Shopping & subscriptions', slot: 6 },
        { name: 'Travel & leisure', slot: 7 },
        { name: 'Family & giving', slot: 8 },
        { name: 'Other', slot: 0 },
      ],
      incomeCategories: ['Salary', 'Interest', 'Other income'],
      kinds: ['spend', 'income', 'transfer', 'card-repayment', 'investment', 'wallet-topup', 'refund', 'fee', 'tax', 'partner-contribution', 'unclassified'],
      buckets: ['purchase', 'renovation', 'furnishing', 'running'],
      months: ['2026-07', '2026-08'],
      aliasesSet: true,
      partnerName: 'Sam',
      inbox: 'C:/example/inputs/statements',
    })),
    accounts: vi.fn(async () => ({
      accounts: [
        { id: 1, label: 'DBS Savings Account ·9876', kind: 'deposit', owner: 'me', currency: 'SGD', seenOnly: false, lastMonth: '2026-08' },
        { id: 2, label: 'Card ·5566', kind: 'card', owner: 'me', currency: 'SGD', seenOnly: true, lastMonth: null },
      ],
    })),
    coverage: vi.fn(async () => ({
      months: ['2026-07', '2026-08'],
      rows: [
        { accountId: 1, account: 'DBS Savings Account ·9876', kind: 'deposit', seenOnly: false, cells: ['ok', 'ok'], unseenCents: [0, 0] },
        { accountId: 2, account: 'Card ·5566', kind: 'card', seenOnly: true, cells: ['missing', 'missing'], unseenCents: [0, 1_318_27] },
      ],
    })),
    overview: vi.fn(async () => ({ empty: true, months: [] })),
    transactions: vi.fn(async () => ({ rows: [], total: 0, outCents: 0, inCents: 0 })),
    files: vi.fn(async () => ({ files: [] })),
    importFiles: vi.fn(async () => ({ items: [], summary: 'No new statements.' })),
    scanInbox: vi.fn(async () => ({ items: [], summary: 'No PDFs in the inbox.' })),
    rebuild: vi.fn(async () => ({ items: [], summary: 'No new statements.' })),
    decide: vi.fn(),
    bulk: vi.fn(async () => ({ updated: 0 })),
    undo: vi.fn(),
    addManual: vi.fn(),
    deleteManual: vi.fn(async () => ({ ok: true })),
    acceptStatement: vi.fn(async () => ({ ok: true })),
    removeFile: vi.fn(async () => ({ ok: true })),
    home: vi.fn(async () => homeData()),
    updateHome: vi.fn(async () => ({ project: homeData().project })),
    addVendor: vi.fn(async () => ({ id: 9 })),
    updateVendor: vi.fn(async () => ({ ok: true })),
    deleteVendor: vi.fn(async () => ({ ok: true })),
    exportHome: vi.fn(async () => ({ blob: new Blob(['x']), name: 'home-project-2026-09-19.csv', saved: true })),
  };
  return { ...base, ...over } as unknown as Api;
}
