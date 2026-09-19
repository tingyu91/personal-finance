import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Paths } from '../config';
import { openDb, type Db } from '../db/open';
import { importFiles, type ImportDeps } from '../import/importer';
import { createApp } from './app';
import { uobCard } from '../../test/fixtures/synthetic/uob-card';
import { useTmpDirs } from '../../test/tmp';

const tmp = useTmpDirs();
const deps: ImportDeps = { extract: async () => uobCard };

let paths: Paths;
let db: Db;
beforeEach(async () => {
  paths = tmp.paths('tally-apihome-');
  db = openDb(paths.dbFile);
  await importFiles(db, paths, [{ name: 'cards.pdf', data: new TextEncoder().encode('cards') }], deps);
});
afterEach(() => db.close());

const send = (method: string, body?: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

describe('home endpoints', () => {
  it('still downloads when the saved copy cannot be written, and says so', async () => {
    const app = createApp({ paths, db, importDeps: deps });
    // A folder where the file should go stands in for a file Excel has locked.
    const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
    fs.mkdirSync(path.join(paths.exportsDir, `home-project-${today}.csv`), { recursive: true });
    const res = await app.request('/api/home/export.csv', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-tally-saved')).toBe('no');
    expect(Buffer.from(await res.arrayBuffer()).toString('utf8')).toContain('"IKEA"');
  });

  it('keeps the screen up when benchmarks.json has a typo', async () => {
    fs.writeFileSync(path.join(paths.rulesDir, 'benchmarks.json'), JSON.stringify({ srs: { checked_on: '2026-9-30' } }));
    const app = createApp({ paths, db, importDeps: deps });
    expect((await app.request('/api/home')).status).toBe(200);
  });

  it('returns the home project with its rows', async () => {
    const app = createApp({ paths, db, importDeps: deps });
    const res = await app.request('/api/home');
    const body = (await res.json()) as { totalCents: number; rows: { payee: string }[]; project: { name: string } };
    expect(body.project.name).toBe('Home');
    expect(body.rows.map((r) => r.payee)).toContain('IKEA');
    expect(body.totalCents).toBe(243_80);
  });

  it('changes the project and vendors, refusing bad values with a plain 400', async () => {
    const app = createApp({ paths, db, importDeps: deps });
    expect((await app.request('/api/home/project', send('PATCH', { budgetCents: 60_000_00 }))).status).toBe(200);
    const bad = await app.request('/api/home/project', send('PATCH', { startMonth: 'soon' }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'Give the start as a month, like 2026-02.' });
    const added = (await (await app.request('/api/home/vendors', send('POST', { name: 'IKEA', contractCents: 1_000_00 }))).json()) as { id: number };
    const home = (await (await app.request('/api/home')).json()) as { vendors: { id: number | null; balanceCents: number | null }[] };
    expect(home.vendors.find((v) => v.id === added.id)!.balanceCents).toBe(1_000_00 - 243_80);
    expect((await app.request(`/api/home/vendors/${added.id}`, send('PATCH', { contractCents: 'lots' }))).status).toBe(400);
    expect((await app.request(`/api/home/vendors/${added.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(`/api/home/vendors/${added.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await app.request('/api/home/vendors/abc', { method: 'DELETE' })).status).toBe(400);
  });

  it('exports CSV to outputs/exports and as a download', async () => {
    const app = createApp({ paths, db, importDeps: deps });
    expect((await app.request('/api/home/export.csv')).status).toBe(404);
    const blocked = await app.request('/api/home/export.csv', { method: 'POST', headers: { origin: 'https://example.com' } });
    expect(blocked.status).toBe(403);
    const res = await app.request('/api/home/export.csv', { method: 'POST' });
    expect(res.headers.get('x-tally-saved')).toBe('yes');
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="home-project-\d{4}-\d{2}-\d{2}\.csv"$/);
    const bytes = Buffer.from(await res.arrayBuffer());
    // UTF-8 byte-order mark, so Excel reads the file as UTF-8.
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.toString('utf8')).toContain('"IKEA"');
    const written = fs.readdirSync(paths.exportsDir).filter((f) => f.startsWith('home-project-'));
    expect(written).toHaveLength(1);
    expect(fs.readFileSync(path.join(paths.exportsDir, written[0]!)).equals(bytes)).toBe(true);
  });
});
