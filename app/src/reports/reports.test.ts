import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Paths } from '../config';
import { openDb, type Db } from '../db/open';
import { importFiles, type ImportDeps } from '../import/importer';
import type { PdfDoc } from '../adapters/types';
import { coverage } from './coverage';
import { dataMonths } from './months';
import { overview } from './overview';
import { dbsConsolidated } from '../../test/fixtures/synthetic/dbs-consolidated';
import { dbsSavings } from '../../test/fixtures/synthetic/dbs-savings';
import { uobCard } from '../../test/fixtures/synthetic/uob-card';
import { uobOne } from '../../test/fixtures/synthetic/uob-one';
import { useTmpDirs } from '../../test/tmp';

const tmp = useTmpDirs();
const FIX: Record<string, PdfDoc> = { consolidated: dbsConsolidated, savings: dbsSavings, cards: uobCard, one: uobOne };
const deps: ImportDeps = { extract: async (d) => FIX[new TextDecoder().decode(d)]! };
const file = (k: string) => ({ name: `${k}.pdf`, data: new TextEncoder().encode(k) });

let paths: Paths;
let db: Db;
beforeAll(async () => {
  paths = tmp.paths('tally-rep-');
  fs.writeFileSync(
    path.join(paths.rulesDir, 'settings.json'),
    JSON.stringify({ self: { aliases: ['ALEX TAN', 'AT & SL Joint'] }, partner: { name: 'Sam', aliases: ['SAM LEE'], refPatterns: ['OCBCSGSGBRT'] } }),
  );
  db = openDb(paths.dbFile);
  await importFiles(db, paths, [file('consolidated'), file('savings'), file('cards'), file('one')], deps);
});
afterAll(() => db.close());

describe('dataMonths', () => {
  it('runs from the earliest to the latest statement month', () => {
    expect(dataMonths(db)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']);
  });
});

describe('coverage', () => {
  const cov = () => coverage(db);
  const row = (name: string) => cov().rows.find((r) => r.account === name)!;

  it('marks the months each account has a statement for', () => {
    expect(row('DBS Savings Account ·9876').cells).toEqual(['missing', 'ok', 'missing', 'missing', 'missing', 'missing', 'missing', 'missing']);
    expect(row('UOB One Account ·5555').cells[6]).toBe('ok');
  });

  it('shows cards seen only as repayment targets as missing in every month, with what went to them', () => {
    const card = row('Card ·5566');
    expect(card.seenOnly).toBe(true);
    expect(card.cells.every((c) => c === 'missing')).toBe(true);
    expect(card.unseenCents[1]).toBe(1_742_18); // February, from the savings account
    expect(card.unseenCents[7]).toBe(1_318_27); // August, from the joint account
    expect(row('Citi Card ·7788').unseenCents[6]).toBe(15_000_00);
  });

  it('nets money the wallet sends back against its top-ups, never below zero', () => {
    const add = (fp: string, date: string, cents: number) =>
      db
        .prepare(
          `INSERT INTO transactions (statement_id, account_id, date, raw, payee, amount_cents, fingerprint, manual, kind, classified_by)
           VALUES (NULL, NULL, ?, 'Funds Transfer · MAXED OUT FROM PAYLAH! : · Robin', 'PayLah', ?, ?, 0, 'transfer', 'wallet')`,
        )
        .run(date, cents, fp);
    add('test:maxed:1', '2026-02-20', 5_00);
    add('test:maxed:2', '2026-03-20', 50_00);
    try {
      const wallet = row('DBS PayLah');
      expect(wallet.unseenCents[1]).toBe(6_40 + 2_30 - 5_00);
      expect(wallet.unseenCents[2]).toBe(0);
    } finally {
      db.prepare("DELETE FROM transactions WHERE fingerprint LIKE 'test:maxed:%'").run();
    }
  });

  it('lists a wallet known only from top-ups, with the top-ups as unseen money', () => {
    const wallet = row('DBS PayLah');
    expect(wallet.seenOnly).toBe(true);
    expect(wallet.unseenCents[1]).toBe(6_40 + 2_30);
  });

  it('leaves out an empty foreign-currency pocket', () => {
    expect(cov().rows.some((r) => r.account.includes('(USD)'))).toBe(false);
  });
});

describe('overview', () => {
  it('adds up a month from classified rows only', () => {
    const o = overview(db, '2026-07');
    // The PayNow to a company waits in Review, so it is not spending yet.
    expect(o.spentCents).toBe(689_40);
    expect(o.notSorted).toMatchObject({ outCents: 250_00 });
    expect(o.homeProjectCents).toBe(0);
    expect(o.incomeCents).toBe(8_400_00 + 1_37);
    expect(o.netCents).toBe(8_401_37 - 689_40);
    expect(o.savingsRate).toBeCloseTo(7_711_97 / 8_401_37, 6);
    expect(o.investedCents).toBe(0);
    expect(o.categories.map((c) => [c.name, c.cents])).toEqual([['Home running', 689_40]]);
  });

  it('keeps the home project out of the headline and the bars, and shows it apart', () => {
    const o = overview(db, '2026-01');
    expect(o.homeProjectCents).toBe(243_80);
    expect(o.categories.map((c) => c.name)).not.toContain('Home project');
  });

  it('moves a row tagged with a bucket from the bars to the home project, whatever its category', () => {
    const shopee = db.prepare("SELECT fingerprint, category FROM transactions WHERE payee LIKE 'Shopee%'").get() as { fingerprint: string; category: string };
    const before = overview(db, '2026-01');
    db.prepare('UPDATE transactions SET bucket = ? WHERE fingerprint = ?').run('furnishing', shopee.fingerprint);
    try {
      const after = overview(db, '2026-01');
      expect(after.homeProjectCents).toBe(before.homeProjectCents + 71_65);
      expect(after.spentCents).toBe(before.spentCents - 71_65);
      const bar = (o: typeof after) => o.categories.find((c) => c.name === shopee.category)?.cents ?? 0;
      expect(bar(after)).toBe(bar(before) - 71_65);
    } finally {
      db.prepare('UPDATE transactions SET bucket = NULL WHERE fingerprint = ?').run(shopee.fingerprint);
    }
  });

  it('says when card statements stop before the month ends', () => {
    const o = overview(db, '2026-01');
    expect(o.coverage.partial.length).toBeGreaterThan(0);
    expect(o.coverage.partial.every((p) => p.through === '2026-01-20')).toBe(true);
    expect(o.coverage.complete).toBe(false);
  });

  it('never counts partner contributions as income, and says what is not yet sorted', () => {
    const o = overview(db, '2026-08');
    expect(o.incomeCents).toBe(0);
    expect(o.partnerCents).toBe(612_00 + 1_650_00);
    expect(o.spentCents).toBe(213_45);
    expect(o.notSorted).toEqual({ count: 1, outCents: 17_00, inCents: 0 });
  });

  it('adds up cash on hand from the latest balance of each account, and flags stale ones', () => {
    const o = overview(db, '2026-07');
    expect(o.cashOnHandCents).toBe(1_069_97 + 30_212_22);
    expect(o.cashStale).toEqual(['DBS Savings Account ·9876']);
    expect(o.cashTrend.at(-1)).toEqual({ month: '2026-07', cents: 1_069_97 + 30_212_22 });
  });

  it('carries the coverage state for the month', () => {
    const o = overview(db, '2026-08');
    expect(o.coverage.complete).toBe(false);
    expect(o.coverage.unseenCents).toBe(1_318_27);
    expect(o.coverage.missing).toEqual(expect.arrayContaining(['DBS Savings Account ·9876', 'UOB One Account ·5555']));
  });
});
