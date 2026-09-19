import { vi } from 'vitest';
import type { Api } from '../api';

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
  };
  return { ...base, ...over } as unknown as Api;
}
