import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Paths } from '../config';
import { openDb, type Db } from '../db/open';
import { findPdfs, importFiles, type ImportDeps } from './importer';
import { rebuildFromVault } from './rebuild';
import { setDecision } from '../decisions';
import { PdfPasswordError } from '../pdf/extract';
import type { PdfDoc } from '../adapters/types';
import { dbsConsolidated } from '../../test/fixtures/synthetic/dbs-consolidated';
import { dbsSavings } from '../../test/fixtures/synthetic/dbs-savings';
import { uobCard } from '../../test/fixtures/synthetic/uob-card';
import { doc, line, page, at } from '../../test/fixtures/pdf';
import { useTmpDirs } from '../../test/tmp';

const tmp = useTmpDirs();

/** Same savings statement, but its carried-forward balance is a cent off, so it fails. */
function unbalanced(): PdfDoc {
  const d = structuredClone(dbsSavings);
  const carry = d.pages[1]!.lines.find((l) => l.text.startsWith('Balance Carried Forward'))!;
  carry.items.at(-1)!.str = '1,069.98';
  return d;
}
/** The savings statement with a different closing: clashes with the real one. */
function reissued(): PdfDoc {
  const d = unbalanced();
  const total = d.pages[1]!.lines.find((l) => l.text.startsWith('Total'))!;
  total.items[2]!.str = '912.38';
  const last = d.pages[1]!.lines.find((l) => l.text.startsWith('28 Feb'))!;
  last.items.find((i) => i.str === '0.12')!.str = '0.13';
  last.items.at(-1)!.str = '1,069.98';
  return d;
}

const FIX: Record<string, () => PdfDoc> = { consolidated: () => dbsConsolidated, savings: () => dbsSavings, cards: () => uobCard, unbalanced };

/** How each file reads during the rebuild, when it should read differently from the import. */
let rereads: Record<string, 'locked' | 'unknown' | 'throws' | 'reissued'> = {};
const deps: ImportDeps = {
  extract: async (d) => {
    const key = new TextDecoder().decode(d);
    switch (rereads[key]) {
      case 'locked':
        throw new PdfPasswordError('needed');
      case 'unknown':
        return doc(page(1, line(700, at(40, 'Some other bank statement'))));
      case 'throws':
        return {
          get pages(): never {
            throw new Error('the reader crashed');
          },
        } as PdfDoc;
      case 'reissued':
        return reissued();
      default:
        return FIX[key]!();
    }
  },
  now: () => new Date('2026-03-05T10:00:00+08:00'),
};
const file = (k: string) => ({ name: `${k}.pdf`, data: new TextEncoder().encode(k) });

let paths: Paths;
let db: Db;
async function setup(keys: string[]) {
  paths = tmp.paths('tally-rb-');
  db = openDb(paths.dbFile);
  await importFiles(db, paths, keys.map(file), deps);
}
beforeEach(async () => {
  rereads = {};
  await setup(['consolidated', 'savings', 'cards']);
});
afterEach(() => db.close());

const count = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n;
const rowsOf = (name: string) =>
  count('SELECT COUNT(*) n FROM transactions t JOIN statements s ON s.id = t.statement_id JOIN files f ON f.id = s.file_id WHERE f.original_name = ?', name);
const statusOf = (res: { items: { name: string; status: string }[] }, name: string) => res.items.find((i) => i.name === name)!.status;

describe('rebuildFromVault', () => {
  it('re-reads every vaulted PDF and keeps every decision', async () => {
    const rows = count('SELECT COUNT(*) n FROM transactions');
    const vaulted = findPdfs([paths.vaultDir]).length;
    const john = db.prepare("SELECT fingerprint FROM transactions WHERE payee = 'John Doe' ORDER BY id LIMIT 1").get() as { fingerprint: string };
    const ikea = db.prepare("SELECT fingerprint FROM transactions WHERE payee = 'IKEA'").get() as { fingerprint: string };
    setDecision(db, paths, john.fingerprint, { kind: 'spend', category: 'Family & giving', note: 'Gift' });
    setDecision(db, paths, ikea.fingerprint, { bucket: 'renovation' });

    const ids = db.prepare('SELECT id, original_name FROM files ORDER BY id').all();
    const res = await rebuildFromVault(db, paths, deps);
    expect(res.items.map((i) => i.status)).toEqual(['imported', 'imported', 'imported']);
    expect(db.prepare('SELECT id, original_name FROM files ORDER BY id').all()).toEqual(ids);
    expect(res.summary).toBe('3 statements imported.');
    expect(res.unmatchedDecisions).toBe(0);
    expect(count('SELECT COUNT(*) n FROM transactions')).toBe(rows);
    expect(findPdfs([paths.vaultDir])).toHaveLength(vaulted);
    expect(db.prepare('SELECT kind, category, note FROM transactions WHERE fingerprint = ?').get(john.fingerprint)).toEqual({
      kind: 'spend',
      category: 'Family & giving',
      note: 'Gift',
    });
    expect(db.prepare('SELECT bucket FROM transactions WHERE fingerprint = ?').get(ikea.fingerprint)).toEqual({ bucket: 'renovation' });
  });

  it('keeps manual entries exactly as entered', async () => {
    db.prepare(
      `INSERT INTO transactions (statement_id, account_id, date, raw, payee, amount_cents, fingerprint, manual, kind, category)
       VALUES (NULL, NULL, '2026-03-01', 'Cash', 'Contractor deposit', -50000, 'manual:1', 1, 'spend', 'Home project')`,
    ).run();
    await rebuildFromVault(db, paths, deps);
    expect(db.prepare("SELECT date, payee, amount_cents, manual, kind, category FROM transactions WHERE fingerprint = 'manual:1'").get()).toEqual({
      date: '2026-03-01',
      payee: 'Contractor deposit',
      amount_cents: -50000,
      manual: 1,
      kind: 'spend',
      category: 'Home project',
    });
  });

  it('keeps the import date and an accepted failed statement', async () => {
    db.close();
    await setup(['consolidated', 'unbalanced']);
    db.prepare('UPDATE statements SET accepted = 1 WHERE reconciled = 0').run();
    const before = db.prepare('SELECT original_name, imported_at FROM files ORDER BY original_name').all();
    const res = await rebuildFromVault(db, paths, { ...deps, now: () => new Date('2026-09-19T08:00:00+08:00') });
    expect(statusOf(res, 'unbalanced.pdf')).toBe('failed');
    expect(db.prepare('SELECT original_name, imported_at FROM files ORDER BY original_name').all()).toEqual(before);
    expect(count('SELECT COUNT(*) n FROM statements WHERE reconciled = 0 AND accepted = 1')).toBe(1);
  });

  it.each([
    ['locked', 'locked', /needs its password\. Kept as it was\./],
    ['unknown', 'unrecognised', /Not a statement layout Tally knows yet.*Kept as it was\./],
    ['throws', 'error', /the reader crashed\. Kept as it was\./],
  ] as const)('keeps a file that now reads as %s, with its rows, and rebuilds the rest', async (mode, status, detail) => {
    const kept = rowsOf('savings.pdf');
    const total = count('SELECT COUNT(*) n FROM transactions');
    expect(kept).toBeGreaterThan(0);
    rereads = { savings: mode };
    const res = await rebuildFromVault(db, paths, deps);
    expect(res.items.find((i) => i.name === 'savings.pdf')).toMatchObject({ status, detail: expect.stringMatching(detail) });
    expect(statusOf(res, 'consolidated.pdf')).toBe('imported');
    expect(statusOf(res, 'cards.pdf')).toBe('imported');
    expect(rowsOf('savings.pdf')).toBe(kept);
    expect(count('SELECT COUNT(*) n FROM transactions')).toBe(total);
  });

  it('keeps a file whose vault copy is missing', async () => {
    const f = db.prepare("SELECT vault_path FROM files WHERE original_name = 'savings.pdf'").get() as { vault_path: string };
    fs.rmSync(path.join(paths.vaultDir, f.vault_path));
    const kept = rowsOf('savings.pdf');
    const res = await rebuildFromVault(db, paths, deps);
    expect(res.items.find((i) => i.name === 'savings.pdf')).toMatchObject({ status: 'error', detail: 'The vault copy is missing. Kept as it was.' });
    expect(rowsOf('savings.pdf')).toBe(kept);
  });

  it('keeps a file whose new reading clashes with another file', async () => {
    db.close();
    await setup(['savings', 'consolidated']);
    // The consolidated file now reads as a different savings statement for the same month.
    rereads = { consolidated: 'reissued' };
    const kept = rowsOf('consolidated.pdf');
    const res = await rebuildFromVault(db, paths, deps);
    expect(res.items.find((i) => i.name === 'consolidated.pdf')).toMatchObject({ status: 'conflict', detail: expect.stringMatching(/already covers\. Kept as it was\.$/) });
    expect(rowsOf('consolidated.pdf')).toBe(kept);
    expect(statusOf(res, 'savings.pdf')).toBe('imported');
  });

  it('changes nothing when the settings cannot be read', async () => {
    const before = db.prepare('SELECT fingerprint, kind FROM transactions ORDER BY fingerprint').all();
    fs.writeFileSync(path.join(paths.rulesDir, 'settings.json'), JSON.stringify({ idleCashMonths: 'six' }));
    await expect(rebuildFromVault(db, paths, deps)).rejects.toThrow(/idleCashMonths/);
    expect(db.prepare('SELECT fingerprint, kind FROM transactions ORDER BY fingerprint').all()).toEqual(before);
  });

  it('says how many decisions no longer match a row', async () => {
    db.prepare("INSERT INTO decisions (fingerprint, kind, updated_at) VALUES ('gone', 'spend', '2026-09-19T00:00:00Z')").run();
    const res = await rebuildFromVault(db, paths, deps);
    expect(res.unmatchedDecisions).toBe(1);
    expect(res.summary).toMatch(/1 of your decisions matches no row now/);
    expect(count("SELECT COUNT(*) n FROM decisions WHERE fingerprint = 'gone'")).toBe(1);
  });
});
