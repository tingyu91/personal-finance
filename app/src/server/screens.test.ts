import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Paths } from '../config';
import { openDb, type Db } from '../db/open';
import { importFiles, type ImportDeps } from '../import/importer';
import type { PdfDoc } from '../adapters/types';
import { createApp } from './app';
import { dbsSavings } from '../../test/fixtures/synthetic/dbs-savings';
import { uobOne } from '../../test/fixtures/synthetic/uob-one';
import { useTmpDirs } from '../../test/tmp';

const tmp = useTmpDirs();
function unbalanced(): PdfDoc {
  const d = structuredClone(uobOne);
  d.pages[2]!.lines.find((l) => l.text.startsWith('Total'))!.items[1]!.str = '16,689.41';
  return d;
}
const FIX: Record<string, () => PdfDoc> = { savings: () => dbsSavings, bad: unbalanced };
const deps: ImportDeps = { extract: async (d) => FIX[new TextDecoder().decode(d)]!() };

let paths: Paths;
let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  paths = tmp.paths('tally-scr-');
  db = openDb(paths.dbFile);
  await importFiles(db, paths, ['savings', 'bad'].map((k) => ({ name: `${k}.pdf`, data: new TextEncoder().encode(k) })), deps);
  app = createApp({ paths, db, importDeps: deps });
});
afterEach(() => db.close());

const get = async <T>(url: string) => (await (await app.request(url)).json()) as T;
const post = (url: string, body?: unknown) =>
  app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

describe('screen endpoints', () => {
  it('GET /api/meta describes categories, kinds, buckets and months', async () => {
    const meta = await get<{ categories: { name: string; slot: number }[]; kinds: string[]; buckets: string[]; months: string[]; aliasesSet: boolean }>('/api/meta');
    expect(meta.categories[1]).toEqual({ name: 'Transport', slot: 2 });
    expect(meta.kinds).toContain('card-repayment');
    expect(meta.buckets).toEqual(['purchase', 'renovation', 'furnishing', 'running']);
    expect(meta.months[0]).toBe('2026-02');
    expect(meta.aliasesSet).toBe(false);
  });

  it('GET /api/accounts, /api/coverage and /api/overview answer', async () => {
    const accounts = await get<{ accounts: { label: string }[] }>('/api/accounts');
    expect(accounts.accounts.map((a) => a.label)).toContain('DBS Savings Account ·9876');
    const cov = await get<{ months: string[]; rows: unknown[] }>('/api/coverage');
    expect(cov.months.length).toBeGreaterThan(0);
    const o = await get<{ month: string; spentCents: number }>('/api/overview?month=2026-02');
    expect(o.month).toBe('2026-02');
    const latest = await get<{ month: string }>('/api/overview');
    expect(latest.month).toBe('2026-07');
    expect((await app.request('/api/overview?month=2026-13')).status).toBe(400);
  });

  it('GET /api/transactions filters from the query string', async () => {
    const res = await get<{ rows: { payee: string }[]; total: number }>('/api/transactions?month=2026-02&q=cheong');
    expect(res.rows.map((r) => r.payee)).toEqual(['Cheong']);
  });

  it('lists files, opens the vault PDF, accepts totals and removes a file', async () => {
    const files = await get<{ files: { id: number; statements: { id: number; reconciled: boolean }[] }[] }>('/api/files');
    const bad = files.files.find((f) => f.statements.some((s) => !s.reconciled))!;
    const pdf = await app.request(`/api/files/${bad.id}/pdf`);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(await pdf.text()).toBe('bad');
    expect((await post(`/api/statements/${bad.statements[0]!.id}/accept`)).status).toBe(200);
    const del = await app.request(`/api/files/${bad.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect((await app.request(`/api/files/${bad.id}/pdf`)).status).toBe(404);
  });

  it('removes a file only after a running rebuild finishes, and the rebuild keeps file ids', async () => {
    const before = await get<{ files: { id: number; name: string }[] }>('/api/files');
    const target = before.files[0]!;
    const [rebuilt, removed] = await Promise.all([app.request('/api/rebuild', { method: 'POST' }), app.request(`/api/files/${target.id}`, { method: 'DELETE' })]);
    expect(rebuilt.status).toBe(200);
    expect(removed.status).toBe(200);
    const after = await get<{ files: { id: number; name: string }[] }>('/api/files');
    expect(after.files.map((f) => f.id)).toEqual(before.files.filter((f) => f.id !== target.id).map((f) => f.id));
    expect((await app.request(`/api/files/${target.id}/pdf`)).status).toBe(404);
  });

  it('adds and deletes a manual entry, refusing to delete statement rows', async () => {
    const res = await post('/api/transactions/manual', { date: '2026-02-10', amountCents: -500_00, payee: 'Contractor deposit', kind: 'spend', category: 'Home project' });
    expect(res.status).toBe(200);
    const { transaction } = (await res.json()) as { transaction: { fingerprint: string } };
    expect((await app.request(`/api/transactions/${transaction.fingerprint}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request('/api/transactions/manual', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'null' })).status).toBe(400);
    expect((await app.request('/api/transactions?limit=abc')).status).toBe(200);
    expect((await app.request('/api/files/abc', { method: 'DELETE' })).status).toBe(400);
    const bad = await post('/api/transactions/manual', { date: 'soon', amountCents: -1, payee: 'x', kind: 'spend' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'Give the date as YYYY-MM-DD.' });
    const imported = (await get<{ rows: { fingerprint: string }[] }>('/api/transactions?month=2026-02')).rows[0]!;
    const refuse = await app.request(`/api/transactions/${imported.fingerprint}`, { method: 'DELETE' });
    expect(refuse.status).toBe(400);
  });
});
