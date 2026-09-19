import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Paths } from '../config';
import { openDb, type Db } from '../db/open';
import { findPdfs, importFiles, type ImportDeps } from '../import/importer';
import type { PdfDoc } from '../adapters/types';
import { listTransactions } from './ledger';
import { acceptStatement, listFiles, removeFile } from './statements';
import { addManualEntry, deleteManualEntry, ManualEntryError } from '../manual';
import { rebuildFromVault } from '../import/rebuild';
import { setDecision } from '../decisions';
import { dbsSavings } from '../../test/fixtures/synthetic/dbs-savings';
import { uobOne } from '../../test/fixtures/synthetic/uob-one';
import { useTmpDirs } from '../../test/tmp';

const tmp = useTmpDirs();
function unbalanced(): PdfDoc {
  const d = structuredClone(uobOne);
  const total = d.pages[2]!.lines.find((l) => l.text.startsWith('Total'))!;
  total.items[1]!.str = '16,689.41';
  return d;
}
const FIX: Record<string, () => PdfDoc> = { savings: () => dbsSavings, bad: unbalanced };
const deps: ImportDeps = { extract: async (d) => FIX[new TextDecoder().decode(d)]!() };
const file = (k: string) => ({ name: `${k}.pdf`, data: new TextEncoder().encode(k) });

let paths: Paths;
let db: Db;
beforeEach(async () => {
  paths = tmp.paths('tally-led-');
  fs.writeFileSync(path.join(paths.rulesDir, 'settings.json'), JSON.stringify({ self: { aliases: ['ALEX TAN'] } }));
  db = openDb(paths.dbFile);
  await importFiles(db, paths, [file('savings'), file('bad')], deps);
});
afterEach(() => db.close());

describe('listTransactions', () => {
  it('lists newest first with totals', () => {
    const res = listTransactions(db, { month: '2026-02' });
    expect(res.total).toBe(8);
    expect(res.rows[0]!.date).toBe('2026-02-28');
    expect(res.outCents).toBe(-1_842_40);
    expect(res.inCents).toBe(912_37);
  });

  it('filters by review, kind, category, account and text', () => {
    expect(listTransactions(db, { month: '2026-02', review: true }).rows.every((r) => r.needsReview)).toBe(true);
    expect(listTransactions(db, { kind: 'wallet-topup' }).total).toBe(2);
    expect(listTransactions(db, { q: 'cheong' }).rows.map((r) => r.payee)).toEqual(['Cheong']);
    expect(listTransactions(db, { category: 'Home running' }).rows.map((r) => r.payee)).toEqual(['IRAS property tax']);
    const acct = listTransactions(db, { month: '2026-02' }).rows[0]!.accountId!;
    expect(listTransactions(db, { accountId: acct }).total).toBe(8);
  });

  it('marks rows from a statement that does not reconcile as held, and leaves them out of the sums', () => {
    const july = listTransactions(db, { month: '2026-07' });
    expect(july.rows.every((r) => r.held)).toBe(true);
    expect(july).toMatchObject({ outCents: 0, inCents: 0, notCounted: july.total });
  });
});

describe('statements admin', () => {
  it('lists files with their statements and the failing check', () => {
    const files = listFiles(db);
    const bad = files.find((f) => f.statements.some((s) => !s.reconciled))!;
    expect(bad.statements[0]).toMatchObject({ account: 'UOB One Account ·5555', month: '2026-07', rows: 6, reconciled: false, accepted: false });
    expect(bad.statements[0]!.failure).toBe('Withdrawals match the printed total: statement says S$16,689.41, rows add up to S$16,689.40');
  });

  it('counts a statement’s rows once you accept its totals', () => {
    const st = listFiles(db).flatMap((f) => f.statements).find((s) => !s.reconciled)!;
    acceptStatement(db, paths, st.id);
    expect(listTransactions(db, { month: '2026-07' }).rows.some((r) => r.held)).toBe(false);
  });

  it('removes a file, its statements, rows and vault copy, and keeps decisions', () => {
    const before = findPdfs([paths.vaultDir]).length;
    const f = listFiles(db).find((x) => x.statements.some((s) => !s.reconciled))!;
    const row = listTransactions(db, { month: '2026-07' }).rows[0]!;
    setDecision(db, paths, row.fingerprint, { note: 'kept' });
    removeFile(db, paths, f.id);
    expect(findPdfs([paths.vaultDir])).toHaveLength(before - 1);
    expect(listTransactions(db, { month: '2026-07' }).total).toBe(0);
    expect(db.prepare('SELECT note FROM decisions WHERE fingerprint = ?').get(row.fingerprint)).toEqual({ note: 'kept' });
    // Its account had no other statements, so it goes rather than showing "missing" for ever.
    expect(db.prepare("SELECT COUNT(*) n FROM accounts WHERE last4 = '5555' AND kind = 'deposit'").get()).toEqual({ n: 0 });
  });
});

describe('manual entries', () => {
  it('adds a cash payment that counts, survives a rebuild, and can be deleted', async () => {
    const view = addManualEntry(db, paths, { date: '2026-02-10', amountCents: -500_00, payee: 'Contractor deposit', kind: 'spend', category: 'Home project', bucket: 'renovation', note: 'Cash' });
    expect(view).toMatchObject({ manual: true, kind: 'spend', category: 'Home project', bucket: 'renovation', account: null, held: false });
    await rebuildFromVault(db, paths, deps);
    expect(listTransactions(db, { q: 'Contractor' }).rows).toHaveLength(1);
    deleteManualEntry(db, paths, view.fingerprint);
    expect(listTransactions(db, { q: 'Contractor' }).rows).toHaveLength(0);
  });

  it('rejects entries that do not make sense, in plain words', () => {
    expect(() => addManualEntry(db, paths, { date: '2026-13-01', amountCents: -1, payee: 'x', kind: 'spend' })).toThrow(new ManualEntryError('Give the date as YYYY-MM-DD.'));
    expect(() => addManualEntry(db, paths, { date: '2026-02-01', amountCents: 0, payee: 'x', kind: 'spend' })).toThrow(new ManualEntryError('The amount cannot be zero.'));
    expect(() => addManualEntry(db, paths, { date: '2026-02-01', amountCents: -1, payee: ' ', kind: 'spend' })).toThrow(new ManualEntryError('Say who was paid.'));
    expect(() => addManualEntry(db, paths, { date: '2026-02-01', amountCents: -1, payee: 'x', kind: 'spend', category: 'Salary' })).toThrow(
      new ManualEntryError('“Salary” is an income category, so the kind must be Income.'),
    );
    expect(() => addManualEntry(db, paths, { date: '2026-02-01', amountCents: -1, payee: 'x', kind: 'transfer', bucket: 'renovation' })).toThrow(
      new ManualEntryError('Only spending can go to the home project.'),
    );
    expect(() => addManualEntry(db, paths, { date: '2206-02-01', amountCents: -1, payee: 'x', kind: 'spend' }, '2026-09-19')).toThrow(
      new ManualEntryError('That date is too far from today. Check the year.'),
    );
    expect(() => addManualEntry(db, paths, { date: '2026-02-01', amountCents: -1, payee: 5 as never, kind: 'spend' })).toThrow(new ManualEntryError('Say who was paid.'));
    const imported = listTransactions(db, { month: '2026-02' }).rows[0]!;
    expect(() => deleteManualEntry(db, paths, imported.fingerprint)).toThrow(new ManualEntryError('Only manual entries can be deleted. Statement rows come and go with their statement.'));
  });
});
