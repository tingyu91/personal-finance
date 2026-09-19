import fs from 'node:fs';
import path from 'node:path';
import type { Paths } from './config';

/**
 * data/rules/settings.json (PRD §7.1): name aliases, the idle-cash buffer, the marginal tax
 * rate. It lives with the data, never in git. You (or Claude, on request) edit it.
 */
export interface Settings {
  /** How your own name appears in statement text ("ALEX TAN", "Alex Tan DBS", the joint account's nickname). */
  self: { aliases: string[] };
  /** Your partner: name aliases, and plain-text references that mark their transfers into a joint account. */
  partner: { name: string; aliases: string[]; refPatterns: string[] };
  /** Idle cash insight: deposits above this many months of spending. */
  idleCashMonths: number;
  /** Tax-year insight: your marginal income tax rate (0–1). Null means "not set"; it is never inferred. */
  marginalTaxRate: number | null;
}

export const DEFAULT_SETTINGS: Settings = {
  self: { aliases: [] },
  partner: { name: 'Partner', aliases: [], refPatterns: [] },
  idleCashMonths: 6,
  marginalTaxRate: null,
};

function merge<T>(base: T, over: unknown): T {
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return (over === undefined ? base : over) as T;
  const o = (typeof over === 'object' && over !== null ? over : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...o };
  for (const [k, v] of Object.entries(base as Record<string, unknown>)) out[k] = merge(v, o[k]);
  return out as T;
}

export function settingsFile(paths: Paths): string {
  return path.join(paths.rulesDir, 'settings.json');
}

/** True when `over` lacks a key that `base` has, at any depth. */
function missingKeys(base: unknown, over: unknown): boolean {
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return over === undefined;
  if (typeof over !== 'object' || over === null || Array.isArray(over)) return true;
  return Object.entries(base as Record<string, unknown>).some(([k, v]) => missingKeys(v, (over as Record<string, unknown>)[k]));
}

function textList(v: unknown, key: string, file: string): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new Error(`${file}: ${key} must be a list of text values, like ["ALEX TAN"].`);
  // A blank alias would match every row.
  return (v as string[]).map((x) => x.trim()).filter(Boolean);
}

function check(m: Settings, file: string): Settings {
  if (typeof m.partner.name !== 'string' || !m.partner.name.trim()) throw new Error(`${file}: partner.name must be a name.`);
  if (typeof m.idleCashMonths !== 'number' || !(m.idleCashMonths > 0)) throw new Error(`${file}: idleCashMonths must be a number above 0.`);
  if (m.marginalTaxRate !== null && (typeof m.marginalTaxRate !== 'number' || m.marginalTaxRate < 0 || m.marginalTaxRate > 1)) {
    throw new Error(`${file}: marginalTaxRate must be null or a number from 0 to 1 (0.115 for 11.5%).`);
  }
  return {
    self: { aliases: textList(m.self.aliases, 'self.aliases', file) },
    partner: {
      name: m.partner.name.trim(),
      aliases: textList(m.partner.aliases, 'partner.aliases', file),
      refPatterns: textList(m.partner.refPatterns, 'partner.refPatterns', file),
    },
    idleCashMonths: m.idleCashMonths,
    marginalTaxRate: m.marginalTaxRate,
  };
}

/**
 * Reads settings.json, filling in defaults for keys it lacks. The file is written only when it
 * is missing or lacks a key, so your own formatting and extra keys stay as you left them.
 */
export function loadSettings(paths: Paths): Settings {
  const file = settingsFile(paths);
  let raw: unknown = {};
  const exists = fs.existsSync(file);
  if (exists) {
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error(`Could not read ${file}: ${(e as Error).message}`);
    }
  }
  const isObject = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isObject(raw)) throw new Error(`${file}: the file must hold one JSON object, like {"self": {"aliases": []}}.`);
  for (const k of ['self', 'partner'] as const) {
    const v = (raw as Record<string, unknown>)[k];
    if (v !== undefined && !isObject(v)) throw new Error(`${file}: ${k} must be an object, like {"aliases": []}.`);
  }
  const merged = merge(DEFAULT_SETTINGS, raw);
  const settings = check(merged, file);
  if (!exists || missingKeys(DEFAULT_SETTINGS, raw)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
  }
  return settings;
}
