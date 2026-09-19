import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureDirs, getPaths, type Paths } from '../../src/config';
import { openDb, type Db } from '../../src/db/open';
import { importFiles, scanDatabase } from '../../src/import/importer';
import { hasRealStatements, realPdfs } from './inbox';

/**
 * Block 1 done-check on the real statements, into a throwaway data folder: everything
 * imports and reconciles, a second import is a no-op, and no identifier is stored.
 */
describe.skipIf(!hasRealStatements)('real import end to end', () => {
  let tmp: string;
  let paths: Paths;
  let db: Db;
  const files = () => realPdfs().map((p) => ({ name: path.basename(p), data: new Uint8Array(fs.readFileSync(p)) }));
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-real-'));
    paths = getPaths({ ...process.env, TALLY_DATA_DIR: path.join(tmp, 'data'), TALLY_OUTPUTS_DIR: path.join(tmp, 'out') });
    ensureDirs(paths);
    db = openDb(paths.dbFile);
  });

  // The vault holds copies of the real statements: never leave them in the temp folder.
  afterAll(() => {
    db?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('imports every statement and every one reconciles', async () => {
    const res = await importFiles(db, paths, files());
    const notImported = res.items.filter((i) => i.status !== 'imported').map((i) => `${i.name}: ${i.status} ${i.detail}`);
    expect(notImported).toEqual([]);
    expect(count('SELECT COUNT(*) n FROM statements WHERE reconciled = 0')).toBe(0);
    expect(count('SELECT COUNT(*) n FROM files')).toBe(realPdfs().length);
  });

  it('skips no row on a first import (no fingerprint collisions)', () => {
    expect(count('SELECT COALESCE(SUM(rows_skipped), 0) n FROM statements')).toBe(0);
  });

  it('re-importing is a no-op', async () => {
    const before = count('SELECT COUNT(*) n FROM transactions');
    const res = await importFiles(db, paths, files());
    expect(res.items.every((i) => i.status === 'duplicate')).toBe(true);
    expect(count('SELECT COUNT(*) n FROM transactions')).toBe(before);
    expect(count('SELECT COUNT(*) n FROM files')).toBe(realPdfs().length);
  });

  it('stores no NRIC and no number longer than four digits in any account field', () => {
    expect(scanDatabase(db)).toEqual([]);
    const accounts = db.prepare('SELECT last4, product, bank FROM accounts').all() as { last4: string; product: string; bank: string }[];
    for (const a of accounts) {
      expect(a.last4).toMatch(/^\d{0,4}$/);
      expect(`${a.bank} ${a.product}`).not.toMatch(/\d{5,}/);
    }
  });

  it('keeps one vault copy per imported file', () => {
    const vaulted = (db.prepare('SELECT vault_path FROM files').all() as { vault_path: string }[]).map((f) => f.vault_path);
    expect(new Set(vaulted).size).toBe(vaulted.length);
    for (const v of vaulted) expect(fs.existsSync(path.join(paths.vaultDir, v))).toBe(true);
  });

  it('keeps UOB One’s own bonus-interest figures', () => {
    const metas = (db.prepare("SELECT s.meta_json FROM statements s JOIN accounts a ON a.id = s.account_id WHERE a.product = 'One Account'").all() as {
      meta_json: string;
    }[]).map((m) => JSON.parse(m.meta_json) as Record<string, unknown>);
    expect(metas.length).toBeGreaterThan(0);
    for (const m of metas) {
      expect(typeof m.creditCardEligibleSpendCents).toBe('number');
      expect(m.eligibleSpendMonth).toMatch(/^\d{4}-\d{2}$/);
      expect('bonusInterestCents' in m).toBe(true);
    }
  });
});
