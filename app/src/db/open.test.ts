import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openDb } from './open';
import { MIGRATIONS } from './schema';
import { useTmpDirs } from '../../test/tmp';

const tmp = useTmpDirs();

const tmpFile = () => path.join(tmp.dir('tally-db-'), 'tally.db');

describe('openDb', () => {
  it('uses a rollback journal (not WAL) because the data folder is OneDrive-synced', () => {
    const db = openDb(tmpFile());
    expect(db.pragma('journal_mode', { simple: true })).toBe('delete');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
    db.close();
  });

  it('creates the core tables', () => {
    const db = openDb(tmpFile());
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[];
    expect(tables.map((t) => t.name)).toEqual(expect.arrayContaining(['accounts', 'files', 'statements', 'transactions']));
    db.close();
  });

  it('is idempotent across re-opens and keeps data', () => {
    const file = tmpFile();
    const a = openDb(file);
    a.prepare("INSERT INTO accounts (key, bank, product, kind, last4) VALUES ('deposit:1234:SGD', 'DBS', 'Savings Account', 'deposit', '1234')").run();
    a.close();
    const b = openDb(file);
    expect(b.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
    expect(b.prepare('SELECT COUNT(*) AS n FROM accounts').get()).toEqual({ n: 1 });
    b.close();
  });

  it('never leaves a -wal file next to the database', () => {
    const file = tmpFile();
    const db = openDb(file);
    db.prepare("INSERT INTO accounts (key, bank, product, kind, last4) VALUES ('card:1111:SGD', 'UOB', 'Preferred Visa', 'card', '1111')").run();
    db.close();
    expect(fs.existsSync(`${file}-wal`)).toBe(false);
  });

  it('upgrades a version-1 database in place', () => {
    const file = tmpFile();
    const v1 = new Database(file);
    v1.exec(MIGRATIONS[0]!);
    v1.pragma('user_version = 1');
    v1.close();
    const db = openDb(file);
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(['decisions', 'rules']));
    db.close();
  });

  it('rejects an unknown account kind', () => {
    const db = openDb(tmpFile());
    expect(() => db.prepare("INSERT INTO accounts (key, bank, product, kind, last4) VALUES ('x', 'X', 'X', 'bogus', '')").run()).toThrow();
    db.close();
  });
});
