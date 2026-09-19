import type { Db } from './db/open';
import { sgtDate } from './core/dates';
import { dataMonths } from './reports/months';

/**
 * The home project and its vendors (PRD §7.2). There is one project, "Home". It starts in the
 * first month with statements until you say otherwise (PRD §9), and has no end or budget until
 * you set them.
 */
export class HomeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HomeError';
  }
}

export interface Project {
  /** Null until you change something: a project nobody has edited is not stored. */
  id: number | null;
  name: string;
  startMonth: string;
  /** False while the start follows the first month with statements. */
  startSet: boolean;
  endMonth: string | null;
  budgetCents: number | null;
}

export interface VendorInput {
  name?: unknown;
  match?: unknown;
  contractCents?: unknown;
  note?: unknown;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

type ProjectRow = { id: number; name: string; start_month: string | null; end_month: string | null; budget_cents: number | null };

/** The first month with statements, or this month in Singapore before any import. */
function defaultStart(db: Db): string {
  return dataMonths(db)[0] ?? sgtDate(new Date().toISOString()).slice(0, 7);
}

/**
 * The project as it stands. Reading never writes: until you set a start, it follows the first
 * month with statements, so importing older statements later moves it back with them.
 */
export function getProject(db: Db): Project {
  const row = db.prepare('SELECT id, name, start_month, end_month, budget_cents FROM projects ORDER BY id LIMIT 1').get() as ProjectRow | undefined;
  if (!row) return { id: null, name: 'Home', startMonth: defaultStart(db), startSet: false, endMonth: null, budgetCents: null };
  return {
    id: row.id,
    name: row.name,
    startMonth: row.start_month ?? defaultStart(db),
    startSet: row.start_month !== null,
    endMonth: row.end_month,
    budgetCents: row.budget_cents,
  };
}

/** The stored project's id, storing it (start still following the data) the first time you edit. */
function ensureProject(db: Db): number {
  const row = db.prepare('SELECT id FROM projects ORDER BY id LIMIT 1').get() as { id: number } | undefined;
  if (row) return row.id;
  return Number(db.prepare("INSERT INTO projects (name, start_month, end_month, budget_cents, created_at) VALUES ('Home', NULL, NULL, NULL, ?)").run(new Date().toISOString()).lastInsertRowid);
}

function amount(v: unknown, what: string): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0 || v > 100_000_000_00) throw new HomeError(`${what} must be an amount above zero.`);
  return v;
}

function text(v: unknown, what: string, max = 200): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new HomeError(`${what} must be text.`);
  const t = v.trim();
  if (t.length > max) throw new HomeError(`${what} can be at most ${max} characters.`);
  return t || null;
}

/** startMonth null (or "") goes back to following the first month with statements. */
export function updateProject(db: Db, patch: { startMonth?: unknown; endMonth?: unknown; budgetCents?: unknown }): Project {
  const current = getProject(db);
  let start: string | null = current.startSet ? current.startMonth : null;
  let end = current.endMonth;
  let budget = current.budgetCents;
  if (patch.startMonth !== undefined) {
    if (patch.startMonth === null || patch.startMonth === '') start = null;
    else if (typeof patch.startMonth !== 'string' || !MONTH.test(patch.startMonth)) throw new HomeError('Give the start as a month, like 2026-02.');
    else start = patch.startMonth;
  }
  if (patch.endMonth !== undefined) {
    if (patch.endMonth === null || patch.endMonth === '') end = null;
    else if (typeof patch.endMonth !== 'string' || !MONTH.test(patch.endMonth)) throw new HomeError('Give the end as a month, like 2026-09, or leave it open.');
    else end = patch.endMonth;
  }
  if (patch.budgetCents !== undefined) budget = amount(patch.budgetCents, 'The budget');
  if (end && end < (start ?? defaultStart(db))) throw new HomeError('The project cannot end before it starts.');
  const id = ensureProject(db);
  db.prepare('UPDATE projects SET start_month = ?, end_month = ?, budget_cents = ? WHERE id = ?').run(start, end, budget, id);
  return getProject(db);
}

function checkVendor(v: VendorInput, current?: { name: string; match: string; contract_cents: number | null; note: string | null }) {
  const name = v.name !== undefined ? text(v.name, 'A vendor name', 80) : current?.name ?? null;
  if (!name) throw new HomeError('Give the vendor a name.');
  // The match defaults to the name: most vendors appear on statements as they are called.
  const match = v.match !== undefined ? text(v.match, 'The text to match', 80) : current?.match ?? name;
  if (!match) throw new HomeError('Say what text on a statement marks this vendor.');
  const contract = v.contractCents !== undefined ? amount(v.contractCents, 'The contract sum') : current?.contract_cents ?? null;
  const note = v.note !== undefined ? text(v.note, 'A note', 500) : current?.note ?? null;
  return { name, match, contract, note };
}

export function addVendor(db: Db, v: VendorInput): number {
  const c = checkVendor(v);
  const projectId = ensureProject(db);
  if (db.prepare('SELECT 1 FROM vendors WHERE project_id = ? AND lower(name) = lower(?)').get(projectId, c.name)) throw new HomeError(`There is already a vendor called ${c.name}.`);
  return Number(db.prepare('INSERT INTO vendors (project_id, name, match, contract_cents, note) VALUES (?, ?, ?, ?, ?)').run(projectId, c.name, c.match, c.contract, c.note).lastInsertRowid);
}

export function updateVendor(db: Db, id: number, v: VendorInput): boolean {
  const current = db.prepare('SELECT name, match, contract_cents, note FROM vendors WHERE id = ?').get(id) as
    | { name: string; match: string; contract_cents: number | null; note: string | null }
    | undefined;
  if (!current) return false;
  const c = checkVendor(v, current);
  if (db.prepare('SELECT 1 FROM vendors WHERE id <> ? AND lower(name) = lower(?)').get(id, c.name)) throw new HomeError(`There is already a vendor called ${c.name}.`);
  db.prepare('UPDATE vendors SET name = ?, match = ?, contract_cents = ?, note = ? WHERE id = ?').run(c.name, c.match, c.contract, c.note, id);
  return true;
}

export function deleteVendor(db: Db, id: number): boolean {
  return db.prepare('DELETE FROM vendors WHERE id = ?').run(id).changes > 0;
}
