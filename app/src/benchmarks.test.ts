import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { useTmpDirs } from '../test/tmp';
import { ageInDays, benchmarksFile, defaultBenchmarks, loadBenchmarks } from './benchmarks';

const tmp = useTmpDirs();

describe('benchmarks', () => {
  it('ships defaults where every section is dated', () => {
    const d = defaultBenchmarks();
    for (const section of Object.values(d)) expect((section as { checked_on: string }).checked_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(d.uobOne.minCardSpendCents).toBeGreaterThan(0);
  });

  it('writes the defaults on first run, then reads your file', () => {
    const p = tmp.paths('tally-bench-');
    expect(loadBenchmarks(p)).toEqual(defaultBenchmarks());
    expect(fs.existsSync(benchmarksFile(p))).toBe(true);
    const mine = defaultBenchmarks();
    mine.thresholds.staleDays = 40;
    mine.thresholds.checked_on = '2026-10-01';
    fs.writeFileSync(benchmarksFile(p), JSON.stringify({ thresholds: mine.thresholds }));
    const b = loadBenchmarks(p);
    expect(b.thresholds.staleDays).toBe(40);
    expect(b.uobOne).toEqual(defaultBenchmarks().uobOne);
  });

  it('needs a whole section for outside facts, but fills new thresholds in', () => {
    const p = tmp.paths('tally-bench-');
    fs.writeFileSync(benchmarksFile(p), JSON.stringify({ srs: { capCitizenCents: 1_600_000, checked_on: '2027-01-02' } }));
    expect(() => loadBenchmarks(p)).toThrow(/srs\.capForeignerCents is missing/);
    const t: Record<string, unknown> = { ...defaultBenchmarks().thresholds };
    const { largeUnsortedCents: _dropped, ...older } = t;
    fs.writeFileSync(benchmarksFile(p), JSON.stringify({ thresholds: { ...older, staleDays: 40 } }));
    expect(loadBenchmarks(p).thresholds).toMatchObject({ staleDays: 40, largeUnsortedCents: defaultBenchmarks().thresholds.largeUnsortedCents });
    fs.writeFileSync(benchmarksFile(p), JSON.stringify({ uobOne: { ...defaultBenchmarks().uobOne, salaryTiers: [{ uptoCents: 'lots', ratePct: 1 }] } }));
    expect(() => loadBenchmarks(p)).toThrow(/uobOne\.salaryTiers must be a list of/);
  });

  it('names the key when a value is the wrong type or undated', () => {
    const p = tmp.paths('tally-bench-');
    fs.writeFileSync(benchmarksFile(p), JSON.stringify({ srs: { ...defaultBenchmarks().srs, capCitizenCents: '15300' } }));
    expect(() => loadBenchmarks(p)).toThrow(/srs\.capCitizenCents must be a number/);
    fs.writeFileSync(benchmarksFile(p), JSON.stringify({ srs: { checked_on: 'last year' } }));
    expect(() => loadBenchmarks(p)).toThrow(/srs\.checked_on must be a date/);
    fs.writeFileSync(benchmarksFile(p), '[]');
    expect(() => loadBenchmarks(p)).toThrow(/one JSON object/);
  });

  it('counts the days since a check', () => {
    expect(ageInDays('2026-03-23', '2026-09-19')).toBe(180);
  });
});
