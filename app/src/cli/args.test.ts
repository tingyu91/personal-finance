import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { resolveInputs } from './args';
import { useTmpDirs } from '../../test/tmp';

const tmpDirs = useTmpDirs();

describe('resolveInputs', () => {
  const tmp = tmpDirs.dir('tally-cli-');
  fs.mkdirSync(path.join(tmp, 'inbox', 'uob'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'inbox', 'a.pdf'), '');
  fs.writeFileSync(path.join(tmp, 'inbox', 'uob', 'b.pdf'), '');
  fs.writeFileSync(path.join(tmp, 'one.pdf'), '');
  fs.writeFileSync(path.join(tmp, 'notes.txt'), '');
  const rel = (ps: string[]) => ps.map((p) => path.relative(tmp, p).replace(/\\/g, '/'));

  it('expands folders to the PDFs inside them and keeps PDF files', () => {
    const r = resolveInputs([path.join(tmp, 'inbox'), path.join(tmp, 'one.pdf')], [path.join(tmp, 'unused')]);
    expect(rel(r.files)).toEqual(['inbox/a.pdf', 'inbox/uob/b.pdf', 'one.pdf']);
    expect(r.skipped).toEqual([]);
  });

  it('uses the inbox folders when no paths are given', () => {
    expect(rel(resolveInputs([], [path.join(tmp, 'inbox')]).files)).toEqual(['inbox/a.pdf', 'inbox/uob/b.pdf']);
  });

  it('reports paths that are missing or not PDFs', () => {
    const r = resolveInputs([path.join(tmp, 'notes.txt'), path.join(tmp, 'nope')], []);
    expect(r.files).toEqual([]);
    expect(rel(r.skipped)).toEqual(['notes.txt', 'nope']);
  });

  it('does not list the same file twice', () => {
    const r = resolveInputs([path.join(tmp, 'one.pdf'), path.join(tmp, 'one.pdf')], []);
    expect(r.files).toHaveLength(1);
  });
});
