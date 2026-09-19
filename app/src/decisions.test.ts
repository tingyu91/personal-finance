import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Paths } from './config';
import { openDb, type Db } from './db/open';
import { importFiles, type ImportDeps } from './import/importer';
import type { PdfDoc } from './adapters/types';
import { clearDecision, DecisionError, deleteRule, listRules, setDecision, setDecisions } from './decisions';
import { dbsConsolidated } from '../test/fixtures/synthetic/dbs-consolidated';
import { dbsSavings } from '../test/fixtures/synthetic/dbs-savings';
import { useTmpDirs } from '../test/tmp';

const tmp = useTmpDirs();
const FIX: Record<string, PdfDoc> = { consolidated: dbsConsolidated, savings: dbsSavings };
const deps: ImportDeps = { extract: async (d) => FIX[new TextDecoder().decode(d)]! };
const file = (k: string) => ({ name: `${k}.pdf`, data: new TextEncoder().encode(k) });

let paths: Paths;
let db: Db;
beforeEach(async () => {
  paths = tmp.paths('tally-dec-');
  fs.writeFileSync(path.join(paths.rulesDir, 'settings.json'), JSON.stringify({ self: { aliases: ['ALEX TAN'] } }));
  db = openDb(paths.dbFile);
  await importFiles(db, paths, [file('consolidated'), file('savings')], deps);
});
afterEach(() => db.close());

type Row = { fingerprint: string; kind: string; category: string | null; needs_review: number; note: string | null; classified_by: string };
const byPayee = (payee: string) => db.prepare('SELECT fingerprint, kind, category, needs_review, note, classified_by FROM transactions WHERE payee = ?').all(payee) as Row[];

describe('decisions', () => {
  it('sticks to one row and clears it from Review', () => {
    const [john] = byPayee('John Doe');
    expect(john!.kind).toBe('unclassified');
    setDecision(db, paths, john!.fingerprint, { kind: 'spend', category: 'Family & giving', note: 'Birthday gift' });
    const [after] = byPayee('John Doe');
    expect(after).toMatchObject({ kind: 'spend', category: 'Family & giving', needs_review: 0, note: 'Birthday gift', classified_by: 'decision' });
  });

  it('merges later changes into the same decision', () => {
    const [john] = byPayee('John Doe');
    setDecision(db, paths, john!.fingerprint, { kind: 'spend', category: 'Family & giving' });
    setDecision(db, paths, john!.fingerprint, { note: 'Dinner' });
    expect(byPayee('John Doe')[0]).toMatchObject({ category: 'Family & giving', note: 'Dinner' });
  });

  it('"always for this payee" adds a rule that sorts the payee’s other rows', () => {
    const [cheong] = byPayee('Cheong');
    setDecision(db, paths, cheong!.fingerprint, { kind: 'spend', category: 'Food & groceries' }, { always: true });
    expect(listRules(db).filter((r) => r.source === 'user')).toEqual([
      expect.objectContaining({ field: 'payee', pattern: 'Cheong', sign: 'out', setKind: 'spend', setCategory: 'Food & groceries' }),
    ]);
    // Saying it again replaces the rule rather than stacking another.
    setDecision(db, paths, cheong!.fingerprint, { kind: 'spend', category: 'Transport' }, { always: true });
    expect(listRules(db).filter((r) => r.source === 'user')).toHaveLength(1);
    expect(byPayee('Cheong')[0]!.category).toBe('Transport');
  });

  it('applies to many rows at once and can be undone', () => {
    const rows = byPayee('PayLah top-up');
    expect(rows.length).toBeGreaterThan(1);
    setDecisions(db, paths, rows.map((r) => r.fingerprint), { kind: 'spend', category: 'Food & groceries' });
    expect(byPayee('PayLah top-up').every((r) => r.category === 'Food & groceries')).toBe(true);
    clearDecision(db, paths, rows[0]!.fingerprint);
    expect(byPayee('PayLah top-up').map((r) => r.kind)).toContain('wallet-topup');
  });

  it('turns an income category into income, and says how many rows a rule now covers', () => {
    const inflow = db.prepare("SELECT fingerprint FROM transactions WHERE payee = 'John Doe' AND amount_cents > 0").get() as { fingerprint: string };
    setDecision(db, paths, inflow.fingerprint, { category: 'Other income' });
    expect(db.prepare('SELECT kind, category FROM transactions WHERE fingerprint = ?').get(inflow.fingerprint)).toEqual({ kind: 'income', category: 'Other income' });
    const [first] = byPayee('PayLah top-up'); // two rows: one decided, one sorted by the new rule
    const res = setDecision(db, paths, first!.fingerprint, { category: 'Transport' }, { always: true });
    expect(res.ruleRows).toBe(1);
    expect(listRules(db).find((r) => r.source === 'user')).toMatchObject({ setKind: 'spend', setCategory: 'Transport' });
  });

  it('refuses decisions that contradict themselves or change nothing', () => {
    const [john] = byPayee('John Doe');
    const fp = john!.fingerprint;
    expect(() => setDecision(db, paths, fp, {})).toThrow(new DecisionError('Nothing to change.'));
    expect(() => setDecision(db, paths, fp, { kind: 'income', category: 'Transport' })).toThrow(new DecisionError('“Transport” is a spending category, so the kind must be Spending.'));
    expect(() => setDecision(db, paths, fp, { kind: 'spend', category: 'Salary' })).toThrow(new DecisionError('“Salary” is an income category, so the kind must be Income.'));
    expect(() => setDecision(db, paths, fp, { kind: 'transfer', category: 'Transport' })).toThrow(new DecisionError('Only spending and income take a category.'));
    expect(() => setDecision(db, paths, fp, { kind: 'transfer', bucket: 'renovation' })).toThrow(new DecisionError('Only spending can go to the home project.'));
    expect(() => setDecision(db, paths, fp, { note: { x: 1 } as never })).toThrow(new DecisionError('A note must be text.'));
    expect(() => setDecision(db, paths, fp, { note: 'Ask John' }, { always: true })).toThrow(new DecisionError('Choose a kind or a category to make this a rule for John Doe.'));
  });

  it('rejects what it does not know, in plain words', () => {
    const [john] = byPayee('John Doe');
    expect(() => setDecision(db, paths, john!.fingerprint, { kind: 'gift' as never })).toThrow(new DecisionError('“gift” is not a kind Tally knows.'));
    expect(() => setDecision(db, paths, john!.fingerprint, { category: 'Groceries' })).toThrow(new DecisionError('“Groceries” is not a category Tally knows.'));
    expect(() => setDecision(db, paths, john!.fingerprint, { bucket: 'garden' })).toThrow(new DecisionError('“garden” is not a home project bucket.'));
    expect(() => setDecision(db, paths, 'nope', { kind: 'spend' })).toThrow(new DecisionError('That transaction is not here any more.'));
  });

  it('edits a manual entry in place, and sorting leaves it as you set it', () => {
    db.prepare(
      `INSERT INTO transactions (statement_id, account_id, date, raw, payee, amount_cents, fingerprint, manual, kind, category)
       VALUES (NULL, NULL, '2026-03-01', 'Cash', 'Contractor deposit', -50000, 'manual:1', 1, 'spend', 'Home project')`,
    ).run();
    setDecision(db, paths, 'manual:1', { bucket: 'renovation', note: 'Deposit, cash' });
    expect(db.prepare("SELECT bucket, note FROM transactions WHERE fingerprint = 'manual:1'").get()).toEqual({ bucket: 'renovation', note: 'Deposit, cash' });
    expect(() => setDecision(db, paths, 'manual:1', { category: 'Other income' })).toThrow(new DecisionError('Only spending can go to the home project.'));
    setDecision(db, paths, 'manual:1', { category: 'Other income', bucket: null });
    expect(db.prepare("SELECT kind, category, bucket, note, payee FROM transactions WHERE fingerprint = 'manual:1'").get()).toEqual({
      kind: 'income',
      category: 'Other income',
      bucket: null,
      note: 'Deposit, cash',
      payee: 'Contractor deposit',
    });
    expect(db.prepare("SELECT COUNT(*) n FROM decisions WHERE fingerprint = 'manual:1'").get()).toEqual({ n: 0 });
  });

  it('deletes a rule you made', () => {
    const [cheong] = byPayee('Cheong');
    setDecision(db, paths, cheong!.fingerprint, { category: 'Food & groceries', kind: 'spend' }, { always: true });
    const rule = listRules(db).find((r) => r.source === 'user')!;
    deleteRule(db, paths, rule.id);
    expect(listRules(db).filter((r) => r.source === 'user')).toEqual([]);
  });
});
