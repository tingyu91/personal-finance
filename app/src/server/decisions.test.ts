import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Paths } from '../config';
import { openDb, type Db } from '../db/open';
import { importFiles, type ImportDeps } from '../import/importer';
import { createApp } from './app';
import { dbsSavings } from '../../test/fixtures/synthetic/dbs-savings';
import { useTmpDirs } from '../../test/tmp';

const tmp = useTmpDirs();
const deps: ImportDeps = { extract: async () => dbsSavings };

let paths: Paths;
let db: Db;
beforeEach(async () => {
  paths = tmp.paths('tally-apidec-');
  db = openDb(paths.dbFile);
  await importFiles(db, paths, [{ name: 'savings.pdf', data: new TextEncoder().encode('savings') }], deps);
});
afterEach(() => db.close());

const fp = (payee: string) => (db.prepare('SELECT fingerprint FROM transactions WHERE payee = ? ORDER BY id LIMIT 1').get(payee) as { fingerprint: string }).fingerprint;
const json = (body: unknown) => ({ method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('decision endpoints', () => {
  it('PATCH /api/transactions/:fingerprint records a decision and returns the row', async () => {
    const app = createApp({ paths, db, importDeps: deps });
    const res = await app.request(`/api/transactions/${fp('Cheong')}`, json({ kind: 'spend', category: 'Food & groceries', always: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ transaction: { payee: 'Cheong', kind: 'spend', category: 'Food & groceries', needsReview: false } });
    const rules = (await (await app.request('/api/rules')).json()) as { rules: { source: string; pattern: string }[] };
    expect(rules.rules.filter((r) => r.source === 'user').map((r) => r.pattern)).toEqual(['Cheong']);
  });

  it('answers a bad value with 400 and a plain message', async () => {
    const app = createApp({ paths, db, importDeps: deps });
    const res = await app.request(`/api/transactions/${fp('Cheong')}`, json({ category: 'Groceries' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '“Groceries” is not a category Tally knows.' });
    const missing = await app.request('/api/transactions/nope', json({ kind: 'spend' }));
    expect(missing.status).toBe(404);
  });

  it('applies one change to many rows, and undoes a decision', async () => {
    const app = createApp({ paths, db, importDeps: deps });
    const fps = (db.prepare("SELECT fingerprint FROM transactions WHERE payee = 'PayLah top-up'").all() as { fingerprint: string }[]).map((r) => r.fingerprint);
    const res = await app.request('/api/transactions/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fingerprints: fps, patch: { kind: 'spend', category: 'Food & groceries' } }),
    });
    expect(await res.json()).toEqual({ updated: fps.length });
    const undo = await app.request(`/api/transactions/${fps[0]}/decision`, { method: 'DELETE' });
    expect(undo.status).toBe(200);
    expect(db.prepare('SELECT kind FROM transactions WHERE fingerprint = ?').get(fps[0])).toEqual({ kind: 'wallet-topup' });
  });

  it('answers malformed requests with 400 or 404, never a crash', async () => {
    const app = createApp({ paths, db, importDeps: deps });
    const nullBody = await app.request(`/api/transactions/${fp('Cheong')}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: 'null' });
    expect(nullBody.status).toBe(400);
    expect(await nullBody.json()).toEqual({ error: 'Nothing to change.' });
    const objNote = await app.request(`/api/transactions/${fp('Cheong')}`, json({ note: { a: 1 } }));
    expect(objNote.status).toBe(400);
    expect((await app.request('/api/transactions/nope/decision', { method: 'DELETE' })).status).toBe(404);
    expect((await app.request('/api/rules/abc', { method: 'DELETE' })).status).toBe(400);
    expect((await app.request('/api/rules/999', { method: 'DELETE' })).status).toBe(404);
  });

  it('lists your rules and the seeded ones', async () => {
    const app = createApp({ paths, db, importDeps: deps });
    const body = (await (await app.request('/api/rules')).json()) as { rules: unknown[]; seeds: { id: string }[] };
    expect(body.seeds.map((s) => s.id)).toContain('transport');
  });

  it('POST /api/rebuild re-reads the vault', async () => {
    const app = createApp({ paths, db, importDeps: deps });
    const res = await app.request('/api/rebuild', { method: 'POST' });
    expect(await res.json()).toMatchObject({ summary: '1 statement imported.' });
  });
});
