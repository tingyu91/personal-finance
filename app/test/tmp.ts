import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';
import { getPaths, ensureDirs, type Paths } from '../src/config';

/** Temp folders for a test file, removed when the file's tests finish. Call at the top level. */
export function useTmpDirs(): { dir: (prefix?: string) => string; paths: (prefix?: string) => Paths } {
  const made: string[] = [];
  afterAll(() => {
    for (const d of made) fs.rmSync(d, { recursive: true, force: true });
  });
  const dir = (prefix = 'tally-') => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    made.push(d);
    return d;
  };
  const paths = (prefix = 'tally-') => {
    const d = dir(prefix);
    const p = getPaths({ TALLY_DATA_DIR: path.join(d, 'data'), TALLY_OUTPUTS_DIR: path.join(d, 'outputs'), TALLY_INBOX_DIR: path.join(d, 'inbox') });
    ensureDirs(p);
    return p;
  };
  return { dir, paths };
}
