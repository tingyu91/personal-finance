import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Paths } from './config';
import { ConfigError } from './core/errors';

/**
 * data/rules/benchmarks.json (PRD §4.8, §7.5): every outside rate, cap and threshold, each with
 * the date it was checked. Nothing here is hard-coded in a rule. The first run copies the
 * defaults shipped in rules/benchmarks.default.json; after that the file is yours. Update a
 * value and its checked_on date together, never one without the other.
 */
export interface Tier {
  uptoCents: number | null;
  ratePct: number;
}

interface Dated {
  checked_on: string;
  source: string;
}

export interface Benchmarks {
  uobOne: Dated & {
    minCardSpendCents: number;
    minSalaryCents: number;
    giroDebitsInstead: number;
    salaryTiers: Tier[];
    giroTiers: Tier[];
    baseRatePct: number;
  };
  srs: Dated & { capCitizenCents: number; capForeignerCents: number; deadline: string };
  cpfTopUp: Dated & { selfCapCents: number; familyCapCents: number; deadline: string };
  thresholds: Dated & {
    unseenActCentsPerMonth: number;
    duplicateDays: number;
    duplicateMinCents: number;
    spikeRatio: number;
    subscriptionMonths: number;
    subscriptionAmountTolerancePct: number;
    staleDays: number;
    largeUnsortedCents: number;
    outsideFactsStaleDays: number;
    bonusActWorthCentsPerYear: number;
    budgetWatchRatio: number;
    duplicateSeriesCount: number;
    duplicateSeriesWindowDays: number;
  };
}

const DEFAULTS_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'rules', 'benchmarks.default.json');

export function benchmarksFile(paths: Paths): string {
  return path.join(paths.rulesDir, 'benchmarks.json');
}

export function defaultBenchmarks(): Benchmarks {
  return JSON.parse(fs.readFileSync(DEFAULTS_FILE, 'utf8')) as Benchmarks;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function sameShape(dv: unknown, v: unknown): boolean {
  if (dv === null) return true;
  if (Array.isArray(dv)) return Array.isArray(v);
  if (typeof dv === 'number') return typeof v === 'number' && Number.isFinite(v);
  return typeof v === typeof dv;
}

/**
 * Reads benchmarks.json, creating it from the defaults on first run.
 * - A section you left out uses the defaults (with their own checked_on).
 * - A section about outside facts (uobOne, srs, cpfTopUp) must be complete: a value and its
 *   checked_on date always come from the same place.
 * - thresholds are Tally's own defaults, so keys added in a later version fill in.
 */
export function loadBenchmarks(paths: Paths): Benchmarks {
  const file = benchmarksFile(paths);
  const defaults = defaultBenchmarks();
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(defaults, null, 2)}\n`);
    return defaults;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new ConfigError(`Could not read ${file}: ${(e as Error).message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ConfigError(`${file}: the file must hold one JSON object.`);
  const out = { ...defaults } as Record<string, unknown>;
  for (const [k, v] of Object.entries(defaults)) {
    const mine = (raw as Record<string, unknown>)[k];
    if (mine === undefined) continue;
    if (!mine || typeof mine !== 'object' || Array.isArray(mine)) throw new ConfigError(`${file}: ${k} must be an object.`);
    const section = mine as Record<string, unknown>;
    if (typeof section.checked_on !== 'string' || !DATE.test(section.checked_on)) throw new ConfigError(`${file}: ${k}.checked_on must be a date, like 2026-09-19.`);
    const merged: Record<string, unknown> = k === 'thresholds' ? { ...(v as object), ...section } : { ...section };
    for (const [field, dv] of Object.entries(v as object)) {
      if (!(field in merged)) throw new ConfigError(`${file}: ${k}.${field} is missing. Give it with the date you checked it.`);
      if (!sameShape(dv, merged[field])) throw new ConfigError(`${file}: ${k}.${field} must be ${Array.isArray(dv) ? 'a list' : `a ${typeof dv}`}.`);
    }
    for (const listKey of ['salaryTiers', 'giroTiers']) {
      const list = merged[listKey];
      if (list === undefined) continue;
      const ok = Array.isArray(list) && list.every((t) => t && typeof t === 'object' && typeof t.ratePct === 'number' && (t.uptoCents === null || typeof t.uptoCents === 'number'));
      if (!ok) throw new ConfigError(`${file}: ${k}.${listKey} must be a list of { "uptoCents": number or null, "ratePct": number }.`);
    }
    out[k] = merged;
  }
  return out as unknown as Benchmarks;
}

/** The thresholds, or the shipped defaults when benchmarks.json cannot be read (screens stay up). */
export function thresholdsOrDefault(paths: Paths): Benchmarks['thresholds'] {
  try {
    return loadBenchmarks(paths).thresholds;
  } catch {
    return defaultBenchmarks().thresholds;
  }
}

/** Days since a benchmark section was checked. */
export function ageInDays(checkedOn: string, today: string): number {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${checkedOn}T00:00:00Z`)) / 86_400_000);
}
