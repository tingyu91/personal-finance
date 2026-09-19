import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureDirs, getPaths, type Paths } from '../../src/config';
import { openDb, type Db } from '../../src/db/open';
import { importFiles } from '../../src/import/importer';
import { rebuildFromVault } from '../../src/import/rebuild';
import { setDecision } from '../../src/decisions';
import { cardTarget } from '../../src/classify/cards';
import { INVESTMENT } from '../../src/classify/pipeline';
import { hasTransferMarker, matchesAlias } from '../../src/classify/text';
import { loadSettings } from '../../src/settings';
import { hasRealStatements, realPdfs } from './inbox';

/**
 * Block 2 done-check on the real statements. Needs the real name aliases, which never live in
 * the repo: point TALLY_TEST_SETTINGS at a settings.json (same shape as data/rules/settings.json).
 */
const settingsFile = process.env.TALLY_TEST_SETTINGS;
const ready = hasRealStatements && !!settingsFile && fs.existsSync(settingsFile);

describe.skipIf(!ready)('real classification', () => {
  let tmp: string;
  let paths: Paths;
  let db: Db;
  const rows = (sql: string, ...a: unknown[]) => db.prepare(sql).all(...a) as Record<string, unknown>[];
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-realcls-'));
    paths = getPaths({ ...process.env, TALLY_DATA_DIR: path.join(tmp, 'data'), TALLY_OUTPUTS_DIR: path.join(tmp, 'out') });
    ensureDirs(paths);
    fs.copyFileSync(settingsFile!, path.join(paths.rulesDir, 'settings.json'));
    db = openDb(paths.dbFile);
    await importFiles(db, paths, realPdfs().map((p) => ({ name: path.basename(p), data: new Uint8Array(fs.readFileSync(p)) })));
  });

  afterAll(() => {
    db?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('gives every row a kind', () => {
    expect(count('SELECT COUNT(*) n FROM transactions WHERE kind IS NULL')).toBe(0);
  });

  it('treats every card bill payment from a bank account as a card repayment', () => {
    const bills = rows("SELECT t.raw, t.kind FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.kind = 'deposit' AND t.amount_cents < 0").filter((r) =>
      cardTarget(String(r.raw)),
    );
    expect(bills.length).toBeGreaterThan(0);
    expect(bills.filter((r) => r.kind !== 'card-repayment')).toEqual([]);
  });

  it('never counts wallet top-ups or broker moves as spending', () => {
    expect(count("SELECT COUNT(*) n FROM transactions WHERE raw LIKE '%TOP-UP TO PAYLAH%' AND kind <> 'wallet-topup'")).toBe(0);
    const brokers = rows("SELECT t.raw, t.kind FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.kind = 'deposit'").filter((r) => INVESTMENT.test(String(r.raw)));
    expect(brokers.length).toBeGreaterThan(0);
    expect(brokers.filter((r) => r.kind !== 'investment')).toEqual([]);
  });

  it('classifies at least 95% of non-spend flows without input (PRD §8, Block 2)', () => {
    // Automatic: every non-spend kind the pipeline set on its own. Missed: rows still waiting in
    // Review whose text looks like money between accounts (a bank transfer marker, your own name,
    // a card bill, a telegraphic transfer or a cheque). Some of those are real payments to
    // people, so this under-counts the rate rather than flattering it.
    const auto = count(
      `SELECT COUNT(*) n FROM transactions WHERE classified_by <> 'decision'
       AND kind IN ('transfer', 'card-repayment', 'investment', 'wallet-topup', 'refund', 'partner-contribution')`,
    );
    const aliases = loadSettings(paths).self.aliases;
    const missed = rows("SELECT raw, payee, needs_review FROM transactions WHERE kind = 'unclassified'").filter((r) => {
      const raw = String(r.raw);
      return hasTransferMarker(raw) || matchesAlias(String(r.payee), aliases) || cardTarget(raw) || /TELEGRAPHIC|CHEQUE/i.test(raw);
    });
    expect(missed.every((r) => r.needs_review === 1)).toBe(true);
    expect(auto / (auto + missed.length)).toBeGreaterThanOrEqual(0.95);
  });

  it('pairs both sides of every own-account transfer it finds', () => {
    expect(count("SELECT COUNT(*) n FROM transactions WHERE classified_by = 'own-transfer' AND pair_fingerprint IS NULL")).toBe(0);
    expect(count("SELECT COUNT(*) n FROM transactions WHERE classified_by = 'own-transfer'")).toBeGreaterThan(0);
  });

  it('shows the cards it can only see as repayment targets, each with its repayments', () => {
    const seen = rows(
      `SELECT a.key, COUNT(t.id) n, -SUM(t.amount_cents) repaid FROM accounts a
       JOIN transactions t ON t.target_account_id = a.id AND t.kind = 'card-repayment'
       WHERE a.seen_only_as_target = 1 GROUP BY a.id`,
    );
    expect(seen).toHaveLength(5);
    for (const s of seen) expect(Number(s.repaid)).toBeGreaterThan(0);
  });

  it('keeps a decision through a rebuild from the vault', async () => {
    const target = rows("SELECT fingerprint FROM transactions WHERE kind = 'unclassified' ORDER BY id LIMIT 1")[0] as { fingerprint: string };
    setDecision(db, paths, target.fingerprint, { kind: 'spend', category: 'Family & giving', note: 'rebuild check' });
    const before = count('SELECT COUNT(*) n FROM transactions');
    const res = await rebuildFromVault(db, paths);
    expect(res.items.every((i) => i.status === 'imported')).toBe(true);
    expect(count('SELECT COUNT(*) n FROM transactions')).toBe(before);
    expect(db.prepare('SELECT kind, category, note FROM transactions WHERE fingerprint = ?').get(target.fingerprint)).toEqual({
      kind: 'spend',
      category: 'Family & giving',
      note: 'rebuild check',
    });
  });
});
