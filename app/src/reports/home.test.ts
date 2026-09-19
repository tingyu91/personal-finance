import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Paths } from '../config';
import { openDb, type Db } from '../db/open';
import { importFiles, type ImportDeps } from '../import/importer';
import type { PdfDoc } from '../adapters/types';
import { addManualEntry } from '../manual';
import { setDecision } from '../decisions';
import { addVendor, getProject, HomeError, updateProject, updateVendor, deleteVendor } from '../home';
import { loadSettings } from '../settings';
import { homeProject } from './home';
import { homeCsv } from './homeCsv';
import { PAYER_LABELS } from './home';
import { dbsConsolidated } from '../../test/fixtures/synthetic/dbs-consolidated';
import { dbsSavings } from '../../test/fixtures/synthetic/dbs-savings';
import { uobCard } from '../../test/fixtures/synthetic/uob-card';
import { uobOne } from '../../test/fixtures/synthetic/uob-one';
import { useTmpDirs } from '../../test/tmp';

/** Invented names and figures only: EXAMPLE RENO, Sofa House, Household Helpers. */
const tmp = useTmpDirs();
const FIX: Record<string, PdfDoc> = { consolidated: dbsConsolidated, savings: dbsSavings, cards: uobCard, one: uobOne };
const deps: ImportDeps = { extract: async (d) => FIX[new TextDecoder().decode(d)]! };
const file = (k: string) => ({ name: `${k}.pdf`, data: new TextEncoder().encode(k) });

let paths: Paths;
let db: Db;
beforeEach(async () => {
  paths = tmp.paths('tally-home-');
  fs.writeFileSync(
    path.join(paths.rulesDir, 'settings.json'),
    JSON.stringify({ self: { aliases: ['ALEX TAN', 'AT & SL Joint'] }, partner: { name: 'Sam', aliases: ['SAM LEE'], refPatterns: ['OCBCSGSGBRT'] } }),
  );
  db = openDb(paths.dbFile);
  await importFiles(db, paths, ['consolidated', 'savings', 'cards', 'one'].map(file), deps);
});
afterEach(() => db.close());

const data = () => homeProject(db, loadSettings(paths), { largeUnsortedCents: 50_00 });
const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

describe('homeProject', () => {
  it('starts in the first month with statements, with no end or budget, and reading never stores it', () => {
    expect(getProject(db)).toMatchObject({ id: null, name: 'Home', startMonth: '2026-01', startSet: false, endMonth: null, budgetCents: null });
    data();
    expect(db.prepare('SELECT COUNT(*) n FROM projects').get()).toEqual({ n: 0 });
  });

  it('follows the data until you set a start, even after other edits', () => {
    updateProject(db, { budgetCents: 60_000_00 });
    expect(getProject(db)).toMatchObject({ startMonth: '2026-01', startSet: false, budgetCents: 60_000_00 });
    db.prepare("INSERT INTO transactions (statement_id, account_id, date, raw, payee, amount_cents, fingerprint, manual, kind) VALUES (NULL, NULL, '2025-11-03', 'x', 'x', -1, 'manual:old', 1, 'spend')").run();
    expect(getProject(db).startMonth).toBe('2025-11');
    updateProject(db, { startMonth: '2026-02' });
    expect(getProject(db)).toMatchObject({ startMonth: '2026-02', startSet: true });
    updateProject(db, { startMonth: null });
    expect(getProject(db)).toMatchObject({ startMonth: '2025-11', startSet: false });
  });

  it('adds up every home row, and each bucket, vendor and payer equals the sum of its rows', () => {
    addManualEntry(db, paths, { date: '2026-03-02', amountCents: -2_000_00, payee: 'EXAMPLE RENO', kind: 'spend', category: 'Home project', bucket: 'renovation' });
    addManualEntry(db, paths, { date: '2026-03-09', amountCents: -80_00, payee: 'Hardware shop', kind: 'spend', category: 'Home project' });
    const shopee = db.prepare("SELECT fingerprint FROM transactions WHERE payee LIKE 'Shopee%'").get() as { fingerprint: string };
    setDecision(db, paths, shopee.fingerprint, { bucket: 'furnishing', vendor: 'Sofa House' });

    const h = data();
    expect(h.totalCents).toBe(sum(h.rows.map((r) => r.cents)));
    for (const b of h.buckets) expect(b.cents).toBe(sum(h.rows.filter((r) => r.bucket === b.bucket).map((r) => r.cents)));
    for (const v of h.vendors) expect(v.paidCents).toBe(sum(h.rows.filter((r) => r.vendor === v.name).map((r) => r.cents)));
    expect(sum(h.payers.map((p) => p.cents))).toBe(h.totalCents);

    expect(h.buckets.map((b) => b.bucket)).toEqual(['renovation', 'furnishing', null]);
    expect(h.buckets.find((b) => b.bucket === null)).toEqual({ bucket: null, cents: 80_00, count: 1 });
    expect(h.rows.find((r) => r.payee.startsWith('Shopee'))).toMatchObject({ vendor: 'Sofa House', bucket: 'furnishing' });
  });

  it('puts a supplementary cardholder’s payments under the partner', () => {
    const ikea = data().rows.find((r) => r.payee === 'IKEA')!;
    expect(ikea).toMatchObject({ payer: 'partner', bucket: 'furnishing', cents: 243_80 });
    expect(data().payers).toEqual([{ payer: 'partner', label: 'Sam’s cards', cents: 243_80 }]);
  });

  it('works out a vendor’s balance from its contract sum, and a decision’s vendor beats a match', () => {
    addManualEntry(db, paths, { date: '2026-03-02', amountCents: -2_000_00, payee: 'EXAMPLE RENO PTE LTD', kind: 'spend', category: 'Home project', bucket: 'renovation' });
    const id = addVendor(db, { name: 'Example Reno', match: 'example reno', contractCents: 5_000_00 });
    const v = data().vendors.find((x) => x.id === id)!;
    expect(v).toMatchObject({ name: 'Example Reno', contractCents: 5_000_00, paidCents: 2_000_00, balanceCents: 3_000_00, lastPaid: '2026-03-02', count: 1 });
    updateVendor(db, id, { contractCents: 2_500_00 });
    expect(data().vendors.find((x) => x.id === id)!.balanceCents).toBe(500_00);
    expect(deleteVendor(db, id)).toBe(true);
    expect(data().vendors.find((x) => x.name === 'Example Reno')).toBeUndefined();
  });

  it('lists the partner’s contributions and suggests the vendor a purpose line names', () => {
    addVendor(db, { name: 'Household Helpers', match: 'helpers' });
    const h = data();
    expect(h.contributions.map((c) => [c.purpose, c.cents, c.suggestedVendor, c.homeLike])).toEqual([
      ['Sam Lee Household Aug', 612_00, 'Household Helpers', true],
      ['Sam', 1_650_00, null, false],
    ]);
    expect(h.contributionsCents).toBe(2_262_00);
    expect(h.homeLikeContributionsCents).toBe(612_00);
  });

  it('knows a purpose line that sounds like the home', () => {
    db.prepare("UPDATE transactions SET payee = 'Sam Kitchen Tap' WHERE kind = 'partner-contribution' AND payee = 'Sam'").run();
    expect(data().contributions.find((c) => c.purpose === 'Sam Kitchen Tap')!.homeLike).toBe(true);
    db.prepare("UPDATE transactions SET payee = 'Sam Grab' WHERE payee = 'Sam Kitchen Tap'").run();
    expect(data().contributions.find((c) => c.purpose === 'Sam Grab')!.homeLike).toBe(false);
  });

  it('counts unseen money only from the project’s start', () => {
    const all = data().unseen.cents;
    expect(all).toBeGreaterThan(0);
    updateProject(db, { startMonth: '2026-08' });
    const late = data().unseen;
    expect(late.cents).toBeLessThan(all);
    expect(late.accounts.every((a) => a.cents > 0)).toBe(true);
  });

  it('leaves out rows from a held statement', () => {
    const before = data().totalCents;
    db.prepare("UPDATE statements SET reconciled = 0, accepted = 0 WHERE account_id IN (SELECT id FROM accounts WHERE kind = 'card')").run();
    expect(data().totalCents).toBe(before - 243_80);
  });

  it('keeps a running total that always ends at the total, even with rows before the start', () => {
    const h = data();
    expect(h.cumulative[0]!.month).toBe('2026-01');
    expect(h.cumulative.at(-1)!.cents).toBe(h.totalCents);
    updateProject(db, { startMonth: '2026-03', endMonth: '2026-04' });
    const later = data();
    expect(later.cumulative[0]!.month).toBe('2026-01');
    expect(later.cumulative.at(-1)!.cents).toBe(later.totalCents);
  });

  it('gives a row to the most specific vendor, and to a vendor named exactly like its payee', () => {
    addManualEntry(db, paths, { date: '2026-03-02', amountCents: -500_00, payee: 'LUMEN LIGHTING PTE', kind: 'spend', category: 'Home project', bucket: 'renovation' });
    addManualEntry(db, paths, { date: '2026-03-03', amountCents: -100_00, payee: 'SOFA HOUSE', kind: 'spend', category: 'Home project', bucket: 'furnishing' });
    addVendor(db, { name: 'Lumen', match: 'lumen' });
    addVendor(db, { name: 'Lumen Lighting', match: 'lumen lighting', contractCents: 5_000_00 });
    addVendor(db, { name: 'Sofa House', match: 'sofahse' });
    const v = data().vendors;
    expect(v.find((x) => x.name === 'Lumen Lighting')).toMatchObject({ paidCents: 500_00, balanceCents: 4_500_00 });
    expect(v.find((x) => x.name === 'Lumen')!.paidCents).toBe(0);
    expect(v.filter((x) => x.name.toLowerCase() === 'sofa house')).toEqual([expect.objectContaining({ paidCents: 100_00 })]);
  });

  it('refuses project and vendor changes that make no sense', () => {
    expect(() => updateProject(db, { startMonth: '2026-13' })).toThrow(new HomeError('Give the start as a month, like 2026-02.'));
    expect(() => updateProject(db, { startMonth: '2026-05', endMonth: '2026-04' })).toThrow(new HomeError('The project cannot end before it starts.'));
    expect(() => updateProject(db, { budgetCents: -5 })).toThrow(new HomeError('The budget must be an amount above zero.'));
    expect(() => addVendor(db, { name: ' ' })).toThrow(new HomeError('Give the vendor a name.'));
    addVendor(db, { name: 'Example Reno' });
    expect(() => addVendor(db, { name: 'example reno' })).toThrow(new HomeError('There is already a vendor called example reno.'));
    const other = addVendor(db, { name: 'Other Reno' });
    expect(() => updateVendor(db, other, { name: 'EXAMPLE RENO' })).toThrow(new HomeError('There is already a vendor called EXAMPLE RENO.'));
    expect(() => updateProject(db, { budgetCents: 1e300 })).toThrow(new HomeError('The budget must be an amount above zero.'));
    expect(updateProject(db, { endMonth: '2026-09', budgetCents: 60_000_00 })).toMatchObject({ endMonth: '2026-09', budgetCents: 60_000_00 });
  });
});

describe('homeCsv', () => {
  it('writes Excel-safe CSV: BOM, CRLF, quoted text, defused formulas, plain amounts', () => {
    addManualEntry(db, paths, { date: '2026-03-02', amountCents: -1_234_56, payee: 'EXAMPLE, RENO "A"', kind: 'spend', category: 'Home project', bucket: 'renovation', note: '=SUM(1)' });
    const h = data();
    const csv = homeCsv(h, (p) => PAYER_LABELS(h.partnerName)[p]);
    expect(csv.startsWith('﻿"Date","Payee"')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines.at(-1)).toBe('');
    expect(lines).toHaveLength(h.rows.length + 2);
    const reno = lines.find((l) => l.includes('RENO'))!;
    expect(reno).toContain('"EXAMPLE, RENO ""A"""');
    expect(reno).toContain(',1234.56,');
    expect(reno).toContain(`"'=SUM(1)"`);
    expect(reno.startsWith('2026-03-02,')).toBe(true);
  });
});
