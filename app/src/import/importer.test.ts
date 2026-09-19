import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Paths } from '../config';
import { openDb, type Db } from '../db/open';
import { findIdentifiers } from '../core/redact';
import { PdfPasswordError } from '../pdf/extract';
import type { PdfDoc } from '../adapters/types';
import { findPdfs, importFiles, importPdf, scanDatabase, vaultRelPath, type ImportDeps } from './importer';
import { dbsConsolidated } from '../../test/fixtures/synthetic/dbs-consolidated';
import { dbsSavings } from '../../test/fixtures/synthetic/dbs-savings';
import { uobCard } from '../../test/fixtures/synthetic/uob-card';
import { uobOne } from '../../test/fixtures/synthetic/uob-one';
import { doc, line, page, at } from '../../test/fixtures/pdf';
import { useTmpDirs } from '../../test/tmp';

const tmp = useTmpDirs();

/** Same savings statement, but its final carried-forward balance is a cent off. */
function unbalanced(): PdfDoc {
  const d = structuredClone(dbsSavings);
  const carry = d.pages[1]!.lines.find((l) => l.text.startsWith('Balance Carried Forward'))!;
  carry.items.at(-1)!.str = '1,069.98';
  return d;
}
/** Same account and month as the savings fixture, but a different closing: a re-issue. */
function reissued(): PdfDoc {
  const d = unbalanced();
  const total = d.pages[1]!.lines.find((l) => l.text.startsWith('Total'))!;
  total.items[2]!.str = '912.38';
  const last = d.pages[1]!.lines.find((l) => l.text.startsWith('28 Feb'))!;
  last.items.find((i) => i.str === '0.12')!.str = '0.13';
  last.items.at(-1)!.str = '1,069.98';
  return d;
}

/** File bytes name the fixture the fake extractor returns, so no PDF is needed. */
const FIXTURES: Record<string, () => PdfDoc> = {
  consolidated: () => dbsConsolidated,
  'consolidated-again': () => dbsConsolidated,
  savings: () => dbsSavings,
  cards: () => uobCard,
  one: () => uobOne,
  unbalanced,
  reissued,
  unknown: () => doc(page(1, line(700, at(40, 'OCBC 360 Account statement')))),
};
const deps: ImportDeps = {
  extract: async (data, password) => {
    const key = new TextDecoder().decode(data);
    if (key === 'locked' && password !== 'open sesame') throw new PdfPasswordError(password ? 'incorrect' : 'needed');
    if (key === 'locked') return dbsSavings;
    const f = FIXTURES[key];
    if (!f) throw new Error('not a pdf');
    return f();
  },
  now: () => new Date('2026-09-19T08:00:00+08:00'),
};
const file = (key: string, name = `${key}.pdf`) => ({ name, data: new TextEncoder().encode(key) });

let paths: Paths;
let db: Db;
beforeEach(() => {
  paths = tmp.paths('tally-imp-');
  db = openDb(paths.dbFile);
});
afterEach(() => db.close());

const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;

describe('importPdf', () => {
  it('imports a statement, its account, its rows and a vault copy', async () => {
    const r = await importPdf(db, paths, file('savings', 'Deposit Account Statement_Feb2026.pdf'), deps);
    expect(r.status).toBe('imported');
    expect(r.detail).toBe('DBS Savings Account ·9876, Feb 2026, 8 rows');
    expect(count('SELECT COUNT(*) n FROM accounts')).toBe(1);
    expect(count('SELECT COUNT(*) n FROM transactions')).toBe(8);
    const f = db.prepare('SELECT vault_path, adapter_id, month FROM files').get() as { vault_path: string; adapter_id: string; month: string };
    expect(f).toEqual({ vault_path: 'dbs/savings-account-9876/2026-02-savings.pdf', adapter_id: 'dbs-savings', month: '2026-02' });
    expect(fs.readFileSync(path.join(paths.dataDir, 'vault', f.vault_path), 'utf8')).toBe('savings');
    const st = db.prepare('SELECT reconciled, opening_cents, closing_cents, rows_skipped FROM statements').get();
    expect(st).toEqual({ reconciled: 1, opening_cents: 2_000_00, closing_cents: 1_069_97, rows_skipped: 0 });
    expect(count("SELECT COUNT(*) n FROM transactions WHERE currency = 'SGD'")).toBe(8);
  });

  it('leaves no staging file in the vault', async () => {
    await importPdf(db, paths, file('savings'), deps);
    expect(findPdfs([paths.vaultDir])).toHaveLength(1);
    const all: string[] = [];
    const walk = (d: string) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : all.push(e.name)));
    walk(paths.vaultDir);
    expect(all.every((n) => n.endsWith('.pdf'))).toBe(true);
  });

  it('treats the same bytes as a duplicate and writes nothing', async () => {
    await importPdf(db, paths, file('savings'), deps);
    const again = await importPdf(db, paths, file('savings'), deps);
    expect(again.status).toBe('duplicate');
    expect(again.detail).toBe('Already here, imported 19 Sep 2026');
    expect(count('SELECT COUNT(*) n FROM files')).toBe(1);
    expect(count('SELECT COUNT(*) n FROM transactions')).toBe(8);
  });

  it('treats a different file with the same statement as a duplicate', async () => {
    await importPdf(db, paths, file('consolidated'), deps);
    const again = await importPdf(db, paths, file('consolidated-again'), deps);
    expect(again.status).toBe('duplicate');
    expect(again.detail).toBe('Same statement as one already here');
    expect(count('SELECT COUNT(*) n FROM files')).toBe(1);
  });

  it('refuses a different statement for an account and month already here', async () => {
    await importPdf(db, paths, file('savings'), deps);
    const r = await importPdf(db, paths, file('reissued'), deps);
    expect(r.status).toBe('conflict');
    expect(r.detail).toBe('A different statement for DBS Savings Account ·9876, Feb 2026 is already here. Remove that one first.');
    expect(count('SELECT COUNT(*) n FROM files')).toBe(1);
  });

  it('splits a multi-card statement into one statement per card', async () => {
    const r = await importPdf(db, paths, file('cards'), deps);
    expect(r.status).toBe('imported');
    expect(r.detail).toBe('UOB Preferred Visa ·1111, UOB KrisFlyer UOB Credit Card ·3333, Jan 2026, 8 rows');
    expect(count('SELECT COUNT(*) n FROM statements')).toBe(2);
    const f = db.prepare('SELECT vault_path FROM files').get() as { vault_path: string };
    expect(f.vault_path).toBe('uob/cards/2026-01-card.pdf');
    const supp = db.prepare("SELECT cardholder, card_last4 FROM transactions WHERE cardholder = 'SAM LEE' LIMIT 1").get();
    expect(supp).toEqual({ cardholder: 'SAM LEE', card_last4: '2222' });
  });

  it('holds a statement that does not reconcile and says why', async () => {
    const r = await importPdf(db, paths, file('unbalanced'), deps);
    expect(r.status).toBe('failed');
    expect(r.detail).toBe('Totals don’t match: Opening plus rows equals closing (statement says S$1,069.98, rows add up to S$1,069.97)');
    expect(count('SELECT COUNT(*) n FROM statements WHERE reconciled = 0')).toBe(1);
    expect(count('SELECT COUNT(*) n FROM transactions')).toBe(8);
  });

  it('reports an unknown layout without storing anything', async () => {
    const r = await importPdf(db, paths, file('unknown'), deps);
    expect(r).toMatchObject({ status: 'unrecognised' });
    expect(count('SELECT COUNT(*) n FROM files')).toBe(0);
    expect(fs.readdirSync(path.join(paths.dataDir, 'vault'))).toEqual([]);
  });

  it('reports a file that is not a PDF as unrecognised', async () => {
    const r = await importPdf(db, paths, file('garbage'), deps);
    expect(r.status).toBe('unrecognised');
  });

  it('asks for a password and uses it once', async () => {
    const locked = await importPdf(db, paths, file('locked'), deps);
    expect(locked).toMatchObject({ status: 'locked', detail: 'This PDF needs its password' });
    const wrong = await importPdf(db, paths, { ...file('locked'), password: 'nope' }, deps);
    expect(wrong).toMatchObject({ status: 'locked', detail: 'That password did not open it' });
    const ok = await importPdf(db, paths, { ...file('locked'), password: 'open sesame' }, deps);
    expect(ok.status).toBe('imported');
    const everything = JSON.stringify(db.prepare('SELECT * FROM files').all()) + JSON.stringify(db.prepare('SELECT * FROM statements').all());
    expect(everything).not.toContain('open sesame');
  });

  it('stores no NRIC and no full card or account number anywhere', async () => {
    await importFiles(db, paths, [file('consolidated'), file('savings'), file('cards'), file('one')], deps);
    expect(scanDatabase(db)).toEqual([]);
    const raws = (db.prepare('SELECT raw FROM transactions').all() as { raw: string }[]).map((r) => r.raw);
    expect(raws.some((r) => r.includes('CCC - ·5566 : I-BANK'))).toBe(true);
    expect(raws.some((r) => r.includes('PTXP [NRIC]'))).toBe(true);
    for (const r of raws) expect(findIdentifiers(r)).toEqual([]);
    const last4s = (db.prepare('SELECT last4 FROM accounts').all() as { last4: string }[]).map((a) => a.last4);
    for (const l of last4s) expect(l).toMatch(/^\d{0,4}$/);
  });
});

describe('scanDatabase', () => {
  it('is stricter than redaction, so it catches what redaction might miss', async () => {
    await importPdf(db, paths, file('savings'), deps);
    db.prepare("UPDATE transactions SET note = 'ref S1234567DX and 1234 5678' WHERE seq = 0").run();
    const hits = scanDatabase(db).map((h) => `${h.table}.${h.column}: ${h.found}`);
    expect(hits).toEqual(['transactions.note: [NRIC]', 'transactions.note: ••••5678']);
  });
});

describe('importFiles', () => {
  it('summarises a batch in plain words', async () => {
    const res = await importFiles(db, paths, [file('savings'), file('savings'), file('unknown'), file('unbalanced', 'b.pdf')], deps);
    expect(res.items.map((i) => i.status)).toEqual(['imported', 'duplicate', 'unrecognised', 'conflict']);
    expect(res.summary).toBe('1 statement imported. 1 already here. 1 not recognised. 1 clashes with a statement already here.');
  });

  it('counts a statement that does not reconcile in the summary', async () => {
    const res = await importFiles(db, paths, [file('unbalanced')], deps);
    expect(res.summary).toBe('No new statements. 1 with totals that don’t match.');
  });

  it('keeps going when one file fails, and says what went wrong', async () => {
    const broken: ImportDeps = {
      ...deps,
      extract: async (data, pw) => {
        if (new TextDecoder().decode(data) === 'boom') throw Object.assign(new Error('disk is locked'), { name: 'SqliteError' });
        return deps.extract!(data, pw);
      },
    };
    const res = await importFiles(db, paths, [file('boom'), file('savings')], broken);
    expect(res.items.map((i) => i.status)).toEqual(['unrecognised', 'imported']);
  });

  it('stores nothing when the vault copy cannot be moved into place, so a retry works', async () => {
    const locked: ImportDeps = {
      ...deps,
      stageVault: (_dir, rel) => ({
        rel,
        commit: () => {
          throw new Error('file is locked by another program');
        },
        discard: () => undefined,
      }),
    };
    const res = await importFiles(db, paths, [file('savings')], locked);
    expect(res.items.map((i) => [i.status, i.detail])).toEqual([['error', 'Could not import this file: file is locked by another program']]);
    expect(count('SELECT COUNT(*) n FROM files')).toBe(0);
    expect(count('SELECT COUNT(*) n FROM transactions')).toBe(0);
    const retry = await importFiles(db, paths, [file('savings')], deps);
    expect(retry.items[0]!.status).toBe('imported');
  });

  it('turns an unexpected error into a failed receipt instead of stopping the batch', async () => {
    const res = await importFiles(db, paths, [file('savings'), file('cards')], {
      ...deps,
      now: () => {
        throw new Error('clock stopped');
      },
    });
    expect(res.items.map((i) => [i.status, i.detail])).toEqual([
      ['error', 'Could not import this file: clock stopped'],
      ['error', 'Could not import this file: clock stopped'],
    ]);
    expect(res.summary).toBe('No new statements. 2 could not be imported.');
  });
});

describe('helpers', () => {
  it('names vault files by bank, account, month and kind', () => {
    expect(vaultRelPath('DBS', 'My Account', '9871', '2026-08', 'consolidated')).toBe('dbs/my-account-9871/2026-08-consolidated.pdf');
  });
  it('finds PDFs recursively and ignores other files', () => {
    const d = tmp.dir('tally-find-');
    fs.mkdirSync(path.join(d, 'a', 'b'), { recursive: true });
    fs.writeFileSync(path.join(d, 'a', 'x.pdf'), '');
    fs.writeFileSync(path.join(d, 'a', 'b', 'Y.PDF'), '');
    fs.writeFileSync(path.join(d, 'a', 'notes.txt'), '');
    expect(findPdfs([d, path.join(d, 'missing')]).map((p) => path.relative(d, p).replace(/\\/g, '/'))).toEqual(['a/b/Y.PDF', 'a/x.pdf']);
  });
});
