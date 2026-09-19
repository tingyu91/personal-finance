import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Paths } from '../config';
import { openDb, type Db } from '../db/open';
import { importFiles, type ImportDeps } from '../import/importer';
import type { PdfDoc } from '../adapters/types';
import { loadSettings } from '../settings';
import { classifyAll } from './run';
import { dbsConsolidated } from '../../test/fixtures/synthetic/dbs-consolidated';
import { dbsSavings } from '../../test/fixtures/synthetic/dbs-savings';
import { uobCard } from '../../test/fixtures/synthetic/uob-card';
import { uobOne } from '../../test/fixtures/synthetic/uob-one';
import { useTmpDirs } from '../../test/tmp';

const tmp = useTmpDirs();
const FIX: Record<string, PdfDoc> = { consolidated: dbsConsolidated, savings: dbsSavings, cards: uobCard, one: uobOne };
const deps: ImportDeps = { extract: async (data) => FIX[new TextDecoder().decode(data)]! };
const file = (key: string) => ({ name: `${key}.pdf`, data: new TextEncoder().encode(key) });

let paths: Paths;
let db: Db;
beforeEach(() => {
  paths = tmp.paths('tally-run-');
  // Invented aliases for the invented fixtures.
  fs.writeFileSync(
    path.join(paths.rulesDir, 'settings.json'),
    JSON.stringify({ self: { aliases: ['ALEX TAN', 'AT & SL Joint'] }, partner: { name: 'Sam', aliases: ['SAM LEE'], refPatterns: ['OCBCSGSGBRT'] } }),
  );
  db = openDb(paths.dbFile);
});
afterEach(() => db.close());

const all = () =>
  db.prepare('SELECT fingerprint, payee, kind, category, pair_fingerprint, target_account_id, needs_review, classified_by FROM transactions ORDER BY id').all();

describe('classifyAll', () => {
  it('classifies every row after an import', async () => {
    await importFiles(db, paths, [file('consolidated'), file('savings'), file('cards'), file('one')], deps);
    expect(db.prepare('SELECT COUNT(*) n FROM transactions WHERE kind IS NULL').get()).toEqual({ n: 0 });
    const kinds = (db.prepare("SELECT kind FROM transactions WHERE raw LIKE '%TOP-UP TO PAYLAH%'").all() as { kind: string }[]).map((r) => r.kind);
    expect(new Set(kinds)).toEqual(new Set(['wallet-topup']));
    const partner = db.prepare("SELECT kind, payee FROM transactions WHERE raw LIKE 'Advice FAST Payment / Receipt · SAM LEE HOUSEHOLD%'").get();
    expect(partner).toEqual({ kind: 'partner-contribution', payee: 'Sam Lee Household Aug' });
  });

  it('creates each card seen only as a repayment target once, and links repayments to it', async () => {
    await importFiles(db, paths, [file('consolidated'), file('savings'), file('one')], deps);
    const seen = db.prepare('SELECT key, bank, product, seen_only_as_target FROM accounts WHERE seen_only_as_target = 1 ORDER BY key').all();
    expect(seen).toEqual([
      { key: 'card:5566:SGD', bank: '', product: 'Card', seen_only_as_target: 1 },
      { key: 'card:7788:SGD', bank: 'Citi', product: 'Card', seen_only_as_target: 1 },
    ]);
    const target = db.prepare("SELECT id FROM accounts WHERE key = 'card:5566:SGD'").get() as { id: number };
    const repaid = db.prepare("SELECT COUNT(*) n FROM transactions WHERE kind = 'card-repayment' AND target_account_id = ?").get(target.id);
    expect(repaid).toEqual({ n: 2 });
  });

  it('is idempotent', async () => {
    await importFiles(db, paths, [file('consolidated'), file('savings'), file('cards'), file('one')], deps);
    const first = all();
    classifyAll(db, loadSettings(paths));
    classifyAll(db, loadSettings(paths));
    expect(all()).toEqual(first);
    expect(db.prepare('SELECT COUNT(*) n FROM accounts WHERE seen_only_as_target = 1').get()).toEqual({ n: 2 });
  });

  it('keeps a seen-only card and its history when the card’s own statements arrive', async () => {
    await importFiles(db, paths, [file('savings')], deps);
    const before = db.prepare("SELECT id FROM accounts WHERE key = 'card:5566:SGD'").get() as { id: number };
    expect(before).toBeTruthy();
    // Pretend the card's statement arrived: the importer upgrades the account in place.
    db.prepare("UPDATE accounts SET seen_only_as_target = 0, bank = 'UOB', product = 'Example Card' WHERE id = ?").run(before.id);
    classifyAll(db, loadSettings(paths));
    const after = db.prepare("SELECT id, seen_only_as_target FROM accounts WHERE key = 'card:5566:SGD'").get();
    expect(after).toEqual({ id: before.id, seen_only_as_target: 0 });
  });
});
