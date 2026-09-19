import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app';
import type { Paths } from '../config';
import { openDb, type Db } from '../db/open';
import type { ImportDeps } from '../import/importer';
import { dbsSavings } from '../../test/fixtures/synthetic/dbs-savings';
import { uobCard } from '../../test/fixtures/synthetic/uob-card';
import { useTmpDirs } from '../../test/tmp';

const tmp = useTmpDirs();

const deps: ImportDeps = {
  extract: async (data) => {
    const key = new TextDecoder().decode(data);
    if (key === 'savings') return dbsSavings;
    if (key === 'cards') return uobCard;
    throw new Error('not a pdf');
  },
};

let paths: Paths;
let db: Db;
beforeEach(() => {
  paths = tmp.paths('tally-api-');
  db = openDb(paths.dbFile);
});
afterEach(() => db.close());

function form(...files: [string, string][]): FormData {
  const f = new FormData();
  for (const [name, content] of files) f.append('files', new File([content], name, { type: 'application/pdf' }));
  return f;
}

describe('POST /api/import', () => {
  it('imports dropped files and returns a receipt', async () => {
    const app = createApp({ paths, db, importDeps: deps });
    const res = await app.request('/api/import', { method: 'POST', body: form(['feb.pdf', 'savings'], ['cards.pdf', 'cards']) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { name: string; status: string }[]; summary: string };
    expect(body.items.map((i) => [i.name, i.status])).toEqual([
      ['feb.pdf', 'imported'],
      ['cards.pdf', 'imported'],
    ]);
    expect(body.summary).toBe('2 statements imported.');
  });

  it('says so when no files were sent', async () => {
    const app = createApp({ paths, db, importDeps: deps });
    const res = await app.request('/api/import', { method: 'POST', body: new FormData() });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Choose at least one PDF to import.' });
  });
});

describe('POST /api/import/inbox', () => {
  it('scans the inbox folders', async () => {
    fs.mkdirSync(paths.inboxDir, { recursive: true });
    fs.writeFileSync(path.join(paths.inboxDir, 'a.pdf'), 'savings');
    fs.writeFileSync(path.join(paths.inboxDir, 'b.pdf'), 'savings');
    const app = createApp({ paths, db, importDeps: deps });
    const res = await app.request('/api/import/inbox', { method: 'POST' });
    const body = (await res.json()) as { items: { status: string }[]; summary: string };
    expect(body.items.map((i) => i.status)).toEqual(['imported', 'duplicate']);
    expect(body.summary).toBe('1 statement imported. 1 already here.');
  });

  it('tells you where the inbox is when it is empty', async () => {
    const app = createApp({ paths, db, importDeps: deps });
    const body = (await (await app.request('/api/import/inbox', { method: 'POST' })).json()) as { items: unknown[]; summary: string };
    expect(body.items).toEqual([]);
    expect(body.summary).toBe(`No PDFs in the inbox. Put statements in ${paths.inboxDir} and scan again.`);
  });
});
