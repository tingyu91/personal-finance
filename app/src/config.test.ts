import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getPaths, ensureDirs } from './config';
import { useTmpDirs } from '../test/tmp';

const tmpDirs = useTmpDirs();

describe('config', () => {
  it('defaults data to personal-finance/data and the inbox to inputs/statements', () => {
    const p = getPaths({});
    expect(path.basename(p.root)).toBe('personal-finance');
    expect(p.dataDir).toBe(path.join(p.root, 'data'));
    expect(p.inboxDir).toBe(path.join(p.root, 'inputs', 'statements'));
    expect(p.dbFile).toBe(path.join(p.dataDir, 'tally.db'));
    expect(p.outputsDir).toBe(path.join(p.root, 'outputs'));
  });

  it('honours TALLY_DATA_DIR, TALLY_INBOX_DIR and TALLY_OUTPUTS_DIR', () => {
    const p = getPaths({ TALLY_DATA_DIR: '/tmp/x', TALLY_INBOX_DIR: '/tmp/in', TALLY_OUTPUTS_DIR: '/tmp/out' });
    expect(p.dataDir).toBe(path.resolve('/tmp/x'));
    expect(p.inboxDir).toBe(path.resolve('/tmp/in'));
    expect(p.outputsDir).toBe(path.resolve('/tmp/out'));
    expect(p.vaultDir).toBe(path.join(path.resolve('/tmp/x'), 'vault'));
  });

  it('accepts a list of inbox folders separated by the platform delimiter', () => {
    const p = getPaths({ TALLY_INBOX_DIR: ['/tmp/a', '/tmp/b'].join(path.delimiter) });
    expect(p.inboxDirs).toEqual([path.resolve('/tmp/a'), path.resolve('/tmp/b')]);
    expect(p.inboxDir).toBe(path.resolve('/tmp/a'));
    expect(getPaths({}).inboxDirs).toEqual([getPaths({}).inboxDir]);
  });

  it('creates the data and outputs trees but never inputs/', () => {
    const tmp = tmpDirs.dir();
    const p = getPaths({
      TALLY_DATA_DIR: path.join(tmp, 'data'),
      TALLY_OUTPUTS_DIR: path.join(tmp, 'outputs'),
      TALLY_INBOX_DIR: path.join(tmp, 'inputs', 'statements'),
    });
    ensureDirs(p);
    for (const d of [p.dataDir, p.vaultDir, p.rulesDir, p.reviewsDir, p.exportsDir]) {
      expect(fs.existsSync(d)).toBe(true);
    }
    expect(fs.existsSync(path.join(tmp, 'inputs'))).toBe(false);
  });
});
