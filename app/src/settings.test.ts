import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { useTmpDirs } from '../test/tmp';
import { DEFAULT_SETTINGS, loadSettings } from './settings';

const tmp = useTmpDirs();
const tmpPaths = () => tmp.paths('tally-set-');
const file = (p: ReturnType<typeof tmpPaths>) => path.join(p.rulesDir, 'settings.json');

describe('loadSettings', () => {
  it('writes a default file with empty aliases on first run', () => {
    const p = tmpPaths();
    const s = loadSettings(p);
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(s.self.aliases).toEqual([]);
    expect(JSON.parse(fs.readFileSync(file(p), 'utf8'))).toMatchObject({ self: { aliases: [] } });
  });

  it('keeps your values and fills in keys added later', () => {
    const p = tmpPaths();
    fs.writeFileSync(file(p), JSON.stringify({ self: { aliases: ['ALEX TAN'] }, partner: { name: 'Sam', aliases: ['SAM LEE'] }, note: 'mine' }));
    const s = loadSettings(p);
    expect(s.self.aliases).toEqual(['ALEX TAN']);
    expect(s.partner).toEqual({ name: 'Sam', aliases: ['SAM LEE'], refPatterns: [] });
    expect(s.idleCashMonths).toBe(DEFAULT_SETTINGS.idleCashMonths);
    expect(s.marginalTaxRate).toBeNull();
    const onDisk = JSON.parse(fs.readFileSync(file(p), 'utf8'));
    expect(onDisk.note).toBe('mine');
    expect(onDisk.self.aliases).toEqual(['ALEX TAN']);
  });

  it('leaves a complete file exactly as you wrote it', () => {
    const p = tmpPaths();
    const mine = JSON.stringify({ ...DEFAULT_SETTINGS, self: { aliases: ['ALEX TAN'] }, note: 'mine' });
    fs.writeFileSync(file(p), mine);
    loadSettings(p);
    expect(fs.readFileSync(file(p), 'utf8')).toBe(mine);
  });

  it('refuses values of the wrong type, naming the key', () => {
    const p = tmpPaths();
    fs.writeFileSync(file(p), JSON.stringify({ self: { aliases: 'ALEX TAN' } }));
    expect(() => loadSettings(p)).toThrow(/self\.aliases must be a list/);
    fs.writeFileSync(file(p), JSON.stringify({ partner: { refPatterns: [1] } }));
    expect(() => loadSettings(p)).toThrow(/partner\.refPatterns must be a list/);
    fs.writeFileSync(file(p), JSON.stringify({ marginalTaxRate: 11.5 }));
    expect(() => loadSettings(p)).toThrow(/marginalTaxRate must be null or a number from 0 to 1/);
    fs.writeFileSync(file(p), JSON.stringify({ idleCashMonths: 'six' }));
    expect(() => loadSettings(p)).toThrow(/idleCashMonths/);
  });

  it('refuses a section of the wrong shape instead of replacing it', () => {
    const p = tmpPaths();
    for (const bad of [{ self: ['ALEX TAN'] }, { partner: 'Sam' }, { self: null }, ['ALEX TAN']]) {
      fs.writeFileSync(file(p), JSON.stringify(bad));
      expect(() => loadSettings(p)).toThrow(/must (be an object|hold one JSON object)/);
      expect(fs.readFileSync(file(p), 'utf8')).toBe(JSON.stringify(bad));
    }
  });

  it('drops blank aliases, which would match every row', () => {
    const p = tmpPaths();
    fs.writeFileSync(file(p), JSON.stringify({ self: { aliases: ['ALEX TAN', ' ', ''] } }));
    expect(loadSettings(p).self.aliases).toEqual(['ALEX TAN']);
  });

  it('names the file when it cannot be read', () => {
    const p = tmpPaths();
    fs.writeFileSync(file(p), '{ not json');
    expect(() => loadSettings(p)).toThrow(/settings\.json/);
  });
});
