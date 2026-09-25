import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Paths } from '../config';
import { openDb, type Db } from '../db/open';
import { importFiles, type ImportDeps } from '../import/importer';
import { rebuildFromVault } from '../import/rebuild';
import { addManualEntry } from '../manual';
import { overview } from '../reports/overview';
import type { PdfDoc } from '../adapters/types';
import { createApp } from '../server/app';
import { monthlyReview, writeMonthlyReview } from '../review';
import { dismissInsight, insightFingerprints, listInsights, restoreInsights } from '.';
import { snapshot } from './snapshot';
import { dbsConsolidated } from '../../test/fixtures/synthetic/dbs-consolidated';
import { dbsSavings } from '../../test/fixtures/synthetic/dbs-savings';
import { uobCard } from '../../test/fixtures/synthetic/uob-card';
import { uobOne } from '../../test/fixtures/synthetic/uob-one';
import { useTmpDirs } from '../../test/tmp';

const tmp = useTmpDirs();
const FIX: Record<string, PdfDoc> = { consolidated: dbsConsolidated, savings: dbsSavings, cards: uobCard, one: uobOne };
const deps: ImportDeps = { extract: async (d) => FIX[new TextDecoder().decode(d)]! };
const file = (k: string) => ({ name: `${k}.pdf`, data: new TextEncoder().encode(k) });
const TODAY = '2026-09-19';

let paths: Paths;
let db: Db;
beforeEach(async () => {
  paths = tmp.paths('tally-ins-');
  fs.writeFileSync(
    path.join(paths.rulesDir, 'settings.json'),
    JSON.stringify({ self: { aliases: ['ALEX TAN', 'AT & SL Joint'] }, partner: { name: 'Sam', aliases: ['SAM LEE'], refPatterns: ['OCBCSGSGBRT'] } }),
  );
  db = openDb(paths.dbFile);
  await importFiles(db, paths, ['consolidated', 'savings', 'cards', 'one'].map(file), deps);
});
afterEach(() => db.close());

describe('snapshot', () => {
  it('reads counted rows, UOB One meta, repayment targets and the home project', () => {
    const all = (db.prepare('SELECT COUNT(*) n FROM transactions').get() as { n: number }).n;
    expect(snapshot(db, paths, TODAY).rows.length).toBe(all);
    // Rows of a statement that does not add up stay out.
    db.prepare("UPDATE statements SET reconciled = 0, accepted = 0 WHERE account_id IN (SELECT id FROM accounts WHERE kind = 'card')").run();
    const held = (db.prepare("SELECT COUNT(*) n FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.kind = 'card'").get() as { n: number }).n;
    expect(held).toBeGreaterThan(0);
    const s = snapshot(db, paths, TODAY);
    expect(s.rows.length).toBe(all - held);
    db.prepare("UPDATE statements SET reconciled = 1 WHERE account_id IN (SELECT id FROM accounts WHERE kind = 'card')").run();
    expect(s.rows.some((r) => r.kind === 'card-repayment' && r.targetAccountId !== null)).toBe(true);
    expect(snapshot(db, paths, TODAY).home?.rows.length).toBeGreaterThan(0);
    expect(s.statements.some((st) => 'creditCardEligibleSpendCents' in st.meta || 'interestEarnedYtdCents' in st.meta)).toBe(true);
    expect(s.benchmarks.thresholds.staleDays).toBe(35);
  });
});

describe('listInsights', () => {
  it('finds unseen money on the synthetic statements, and hides what you dismiss or snooze', () => {
    const { insights } = listInsights(db, paths, TODAY);
    const unseen = insights.find((i) => i.rule === 1)!;
    expect(unseen).toBeTruthy();

    dismissInsight(db, unseen.key, undefined, TODAY);
    expect(listInsights(db, paths, TODAY).insights.some((i) => i.key === unseen.key)).toBe(false);
    expect(listInsights(db, paths, TODAY).hidden).toBe(1);

    dismissInsight(db, unseen.key, 30, TODAY);
    expect(listInsights(db, paths, '2026-10-01').insights.some((i) => i.key === unseen.key)).toBe(false);
    expect(listInsights(db, paths, '2026-10-19').insights.some((i) => i.key === unseen.key)).toBe(true);

    expect(restoreInsights(db)).toBe(1);
    expect(listInsights(db, paths, TODAY).hidden).toBe(0);
  });

  it('keeps a dismissal through "Rebuild from vault"', async () => {
    const key = listInsights(db, paths, TODAY).insights.find((i) => i.rule === 1)!.key;
    dismissInsight(db, key, undefined, TODAY);
    await rebuildFromVault(db, paths, deps);
    const after = listInsights(db, paths, TODAY);
    expect(after.insights.some((i) => i.key === key)).toBe(false);
    expect(after.hidden).toBe(1);
  });

  it('says which months are incomplete, for the coverage banner', () => {
    const { coverage } = listInsights(db, paths, TODAY);
    expect(coverage.months.length).toBeGreaterThan(0);
    // The synthetic card repayments go to a card with no statement here.
    expect(coverage.incomplete.length).toBeGreaterThan(0);
    expect(coverage.incomplete.every((m) => coverage.months.includes(m))).toBe(true);
  });

  it('names the broken benchmarks file instead of failing blind', async () => {
    fs.writeFileSync(path.join(paths.rulesDir, 'benchmarks.json'), '{ "uobOne": ');
    const app = createApp({ paths, db, importDeps: deps });
    for (const url of ['/api/insights', '/api/transactions?insight=x']) {
      const res = await app.request(url);
      expect(res.status).toBe(500);
      expect(((await res.json()) as { error: string }).error).toContain('benchmarks.json');
    }
    const review = await app.request('/api/review/2026-08', { method: 'POST' });
    expect(((await review.json()) as { error: string }).error).toContain('benchmarks.json');
  });

  it('gives each insight’s rows to the Transactions filter', async () => {
    const unseen = listInsights(db, paths, TODAY).insights.find((i) => i.rule === 1)!;
    expect(insightFingerprints(db, paths, unseen.key, TODAY)!.fingerprints.sort()).toEqual([...unseen.fingerprints].sort());
    expect(insightFingerprints(db, paths, 'nope', TODAY)).toBeNull();

    const app = createApp({ paths, db, importDeps: deps });
    const res = await app.request(`/api/transactions?insight=${encodeURIComponent(unseen.key)}&limit=1000`);
    const body = (await res.json()) as { rows: { fingerprint: string }[]; insight: { title: string } };
    expect(body.rows.map((r) => r.fingerprint).sort()).toEqual([...unseen.fingerprints].sort());
    expect(body.insight.title).toBe(unseen.title);
    expect((await app.request('/api/transactions?insight=nope')).status).toBe(404);
  });

  it('dismisses through the API, and refuses a bad snooze', async () => {
    const app = createApp({ paths, db, importDeps: deps });
    const key = listInsights(db, paths, TODAY).insights[0]!.key;
    const post = (url: string, b: unknown) => app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    expect((await post('/api/insights/dismiss', { key, days: 0 })).status).toBe(400);
    expect((await post('/api/insights/dismiss', {})).status).toBe(400);
    expect((await post('/api/insights/dismiss', { key, days: 30 })).status).toBe(200);
    const list = (await (await app.request('/api/insights')).json()) as { insights: { key: string }[]; hidden: number };
    expect(list.insights.some((i) => i.key === key)).toBe(false);
    expect((await post('/api/insights/restore', {})).status).toBe(200);
  });
});

describe('monthly review', () => {
  it('writes the month’s coverage, figures, categories, home project and insights', () => {
    const md = monthlyReview(db, paths, '2026-08', TODAY);
    expect(md).toContain('# Tally review: Aug 2026');
    expect(md).toContain('## Coverage');
    expect(md).toContain('| Everyday spending (tax and fees included) |');
    expect(md).toContain('From Sam into the joint account (not income)');
    expect(md).toContain('## Home project');
    expect(md).toMatch(/- \*\*(Act|Watch|Info): /);
    const f = writeMonthlyReview(db, paths, '2026-08', TODAY);
    expect(f).toBe(path.join(paths.reviewsDir, 'review-2026-08.md'));
    expect(fs.readFileSync(f, 'utf8')).toBe(md);
  });

  it('writes a negative net with one minus sign', () => {
    addManualEntry(db, paths, { date: '2026-08-20', amountCents: -1_000_000_00, payee: 'Example Big Spend', kind: 'spend', category: 'Other' }, TODAY);
    expect(overview(db, '2026-08').netCents).toBeLessThan(0);
    const md = monthlyReview(db, paths, '2026-08', TODAY);
    expect(md).toMatch(/\| Net savings \| −S\$[\d,]+\.\d{2} \|/);
    expect(md).not.toContain('−−');
  });

  it('writes it from the API for a month with statements only', async () => {
    const app = createApp({ paths, db, importDeps: deps });
    expect((await app.request('/api/review/2026-08', { method: 'POST' })).status).toBe(200);
    expect((await app.request('/api/review/2030-01', { method: 'POST' })).status).toBe(404);
    expect((await app.request('/api/review/soon', { method: 'POST' })).status).toBe(400);
  });
});
