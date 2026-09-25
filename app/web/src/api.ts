import type { OverviewData } from '../../src/reports/overview';
import type { HomeData } from '../../src/reports/home';
import type { InsightItem } from '../../src/insights/rules';
import type { InsightList } from '../../src/insights';
import type { CoverageRow } from '../../src/reports/coverage';
import type { Ledger } from '../../src/reports/ledger';
import type { FileView } from '../../src/reports/statements';
import type { TransactionView } from '../../src/queries/transactions';
import type { ReceiptItem } from './ds';

export type { OverviewData, CoverageRow, Ledger, FileView, TransactionView, HomeData, InsightItem, InsightList };

export interface VendorInput {
  name?: string;
  match?: string;
  contractCents?: number | null;
  note?: string | null;
}

export interface Meta {
  categories: { name: string; slot: number }[];
  incomeCategories: string[];
  kinds: string[];
  buckets: string[];
  months: string[];
  aliasesSet: boolean;
  partnerName: string;
  inbox: string;
}

export interface AccountView {
  id: number;
  label: string;
  kind: string;
  owner: string;
  currency: string;
  seenOnly: boolean;
  lastMonth: string | null;
}

export interface ImportResult {
  items: ReceiptItem[];
  summary: string;
}

export interface DecisionPatch {
  kind?: string | null;
  category?: string | null;
  bucket?: string | null;
  vendor?: string | null;
  note?: string | null;
}

export interface ManualEntryInput {
  date: string;
  amountCents: number;
  payee: string;
  kind: string;
  category?: string | null;
  accountId?: number | null;
  bucket?: string | null;
  note?: string | null;
}

export interface LedgerFilters {
  month?: string;
  account?: string;
  category?: string;
  kind?: string;
  review?: boolean;
  q?: string;
  /** Only the rows behind one insight. */
  insight?: string;
  limit?: number;
}

export class ApiError extends Error {}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError('Tally’s local server is not answering. Start it with npm start.');
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(body.error ?? `Tally could not do that (${res.status}).`);
  return body as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

function query(f: LedgerFilters): string {
  const q = new URLSearchParams();
  if (f.month) q.set('month', f.month);
  if (f.account) q.set('account', f.account);
  if (f.category) q.set('category', f.category);
  if (f.kind) q.set('kind', f.kind);
  if (f.review) q.set('review', '1');
  if (f.q) q.set('q', f.q);
  if (f.insight) q.set('insight', f.insight);
  if (f.limit) q.set('limit', String(f.limit));
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const api = {
  meta: () => call<Meta>('/api/meta'),
  accounts: () => call<{ accounts: AccountView[] }>('/api/accounts'),
  coverage: () => call<{ months: string[]; rows: CoverageRow[] }>('/api/coverage'),
  overview: (month?: string) => call<OverviewData | { empty: true; months: string[] }>(`/api/overview${month ? `?month=${month}` : ''}`),
  transactions: (f: LedgerFilters) => call<Ledger & { insight?: { key: string; title: string } | null }>(`/api/transactions${query(f)}`),
  files: () => call<{ files: FileView[] }>('/api/files'),
  importFiles: (files: File[], password?: string) => {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    if (password) form.append('password', password);
    return call<ImportResult>('/api/import', { method: 'POST', body: form });
  },
  scanInbox: () => call<ImportResult>('/api/import/inbox', { method: 'POST' }),
  rebuild: () => call<ImportResult>('/api/rebuild', { method: 'POST' }),
  decide: (fingerprint: string, patch: DecisionPatch, always = false) =>
    call<{ transaction: TransactionView }>(`/api/transactions/${encodeURIComponent(fingerprint)}`, json('PATCH', { ...patch, always })),
  bulk: (fingerprints: string[], patch: DecisionPatch) => call<{ updated: number }>('/api/transactions/bulk', json('POST', { fingerprints, patch })),
  undo: (fingerprint: string) => call<{ transaction: TransactionView }>(`/api/transactions/${encodeURIComponent(fingerprint)}/decision`, { method: 'DELETE' }),
  addManual: (entry: ManualEntryInput) => call<{ transaction: TransactionView }>('/api/transactions/manual', json('POST', entry)),
  deleteManual: (fingerprint: string) => call<{ ok: true }>(`/api/transactions/${encodeURIComponent(fingerprint)}`, { method: 'DELETE' }),
  acceptStatement: (id: number) => call<{ ok: true }>(`/api/statements/${id}/accept`, { method: 'POST' }),
  removeFile: (id: number) => call<{ ok: true }>(`/api/files/${id}`, { method: 'DELETE' }),
  home: () => call<HomeData>('/api/home'),
  updateHome: (patch: { startMonth?: string; endMonth?: string | null; budgetCents?: number | null }) => call<{ project: HomeData['project'] }>('/api/home/project', json('PATCH', patch)),
  addVendor: (v: VendorInput) => call<{ id: number }>('/api/home/vendors', json('POST', v)),
  updateVendor: (id: number, v: VendorInput) => call<{ ok: true }>(`/api/home/vendors/${id}`, json('PATCH', v)),
  deleteVendor: (id: number) => call<{ ok: true }>(`/api/home/vendors/${id}`, { method: 'DELETE' }),
  insights: () => call<InsightList>('/api/insights'),
  dismissInsight: (key: string, days?: number) => call<{ ok: true }>('/api/insights/dismiss', json('POST', { key, days })),
  restoreInsights: () => call<{ restored: number }>('/api/insights/restore', { method: 'POST' }),
  writeReview: (month: string) => call<{ file: string }>(`/api/review/${month}`, { method: 'POST' }),
  /** The CSV bytes, its file name, and whether a copy was saved to outputs/exports. */
  exportHome: async (): Promise<{ blob: Blob; name: string; saved: boolean }> => {
    let res: Response;
    try {
      res = await fetch('/api/home/export.csv', { method: 'POST' });
    } catch {
      throw new ApiError('Tally’s local server is not answering. Start it with npm start.');
    }
    if (!res.ok) throw new ApiError(`Tally could not export (${res.status}).`);
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'home-project.csv';
    return { blob: await res.blob(), name, saved: res.headers.get('x-tally-saved') === 'yes' };
  },
};

export type Api = typeof api;
