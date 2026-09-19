import type { Paths } from './config';
import type { Db } from './db/open';
import { BUCKETS, isCategory, isKind, kindForCategory, type Kind } from './classify/categories';
import { SEED_RULES } from './classify/seeds';
import { classifyAll } from './classify/run';
import { loadSettings } from './settings';

/**
 * Your decisions about single rows, and "always do this for this payee" rules. Decisions are
 * keyed by fingerprint so they survive re-parsing and "Rebuild from vault" (PRD §6).
 */
export class DecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecisionError';
  }
}

export interface DecisionPatch {
  kind?: Kind | null;
  category?: string | null;
  bucket?: string | null;
  vendor?: string | null;
  note?: string | null;
}

export interface RuleView {
  id: number;
  source: 'seed' | 'user';
  field: 'payee' | 'raw';
  pattern: string;
  sign: 'in' | 'out' | null;
  setKind: string | null;
  setCategory: string | null;
  setBucket: string | null;
  createdAt: string;
}

const FIELDS = ['kind', 'category', 'bucket', 'vendor', 'note'] as const;
type Field = (typeof FIELDS)[number];
type Merged = Record<Field, string | null>;

const TEXT_NAMES: Record<Field, string> = { kind: 'A kind', category: 'A category', bucket: 'A bucket', vendor: 'A vendor', note: 'A note' };
const MAX_TEXT = 500;

/** The patch on its own: something to change, and every value of the right type and known. */
function validatePatch(patch: DecisionPatch): void {
  if (!FIELDS.some((f) => patch[f] !== undefined)) throw new DecisionError('Nothing to change.');
  for (const f of FIELDS) {
    const v = patch[f];
    if (v !== undefined && v !== null && typeof v !== 'string') throw new DecisionError(`${TEXT_NAMES[f]} must be text.`);
    if (typeof v === 'string' && v.length > MAX_TEXT) throw new DecisionError(`${TEXT_NAMES[f]} can be at most ${MAX_TEXT} characters.`);
  }
  if (patch.kind != null && !isKind(patch.kind)) throw new DecisionError(`“${patch.kind}” is not a kind Tally knows.`);
  if (patch.category != null && !isCategory(patch.category)) throw new DecisionError(`“${patch.category}” is not a category Tally knows.`);
  if (patch.bucket != null && !(BUCKETS as readonly string[]).includes(patch.bucket)) throw new DecisionError(`“${patch.bucket}” is not a home project bucket.`);
}

/** The decision as it will be stored: the kind and category must agree, and buckets are for spending. */
function validateMerged(m: Merged): void {
  if (m.category) {
    const implied = kindForCategory(m.category);
    if (m.kind && m.kind !== implied) {
      if (m.kind !== 'spend' && m.kind !== 'income') throw new DecisionError('Only spending and income take a category.');
      throw new DecisionError(
        implied === 'spend' ? `“${m.category}” is a spending category, so the kind must be Spending.` : `“${m.category}” is an income category, so the kind must be Income.`,
      );
    }
  }
  const kind = m.kind ?? kindForCategory(m.category);
  if (m.bucket && kind && kind !== 'spend') throw new DecisionError('Only spending can go to the home project.');
}

type TxRow = Merged & { payee: string; amount_cents: number; manual: number };

/**
 * The decision as it will be stored. A manual entry is yours already, so it starts from the row
 * itself, and a new category on it brings its kind along.
 */
function merged(db: Db, fingerprint: string, row: TxRow, patch: DecisionPatch): Merged {
  const existing = row.manual
    ? { kind: row.kind, category: row.category, bucket: row.bucket, vendor: row.vendor, note: row.note }
    : (db.prepare('SELECT kind, category, bucket, vendor, note FROM decisions WHERE fingerprint = ?').get(fingerprint) as Merged | undefined);
  const m: Merged = { kind: null, category: null, bucket: null, vendor: null, note: null, ...existing };
  for (const f of FIELDS) if (patch[f] !== undefined) m[f] = patch[f] ?? null;
  if (row.manual && patch.kind === undefined && patch.category) m.kind = kindForCategory(patch.category) ?? m.kind;
  return m;
}

/** Decisions on imported rows live in their own table; a manual entry is edited in place. */
function write(db: Db, fingerprint: string, row: TxRow, m: Merged, now: string): void {
  if (row.manual) {
    db.prepare('UPDATE transactions SET kind = ?, category = ?, bucket = ?, vendor = ?, note = ?, needs_review = 0 WHERE fingerprint = ?').run(
      m.kind ?? kindForCategory(m.category) ?? row.kind,
      m.category,
      m.bucket,
      m.vendor,
      m.note,
      fingerprint,
    );
    return;
  }
  db.prepare(
    `INSERT INTO decisions (fingerprint, kind, category, bucket, vendor, note, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (fingerprint) DO UPDATE SET kind = excluded.kind, category = excluded.category, bucket = excluded.bucket,
       vendor = excluded.vendor, note = excluded.note, updated_at = excluded.updated_at`,
  ).run(fingerprint, m.kind, m.category, m.bucket, m.vendor, m.note, now);
}

function rowFor(db: Db, fingerprint: string): TxRow {
  const row = db.prepare('SELECT payee, amount_cents, manual, kind, category, bucket, vendor, note FROM transactions WHERE fingerprint = ?').get(fingerprint) as
    | TxRow
    | undefined;
  if (!row) throw new DecisionError('That transaction is not here any more.');
  return row;
}

/**
 * Records a decision on one row. With `always`, also makes a rule for the row's payee; the rule
 * stores the kind itself, so it never guesses one from the sign of an amount.
 */
export function setDecision(db: Db, paths: Paths, fingerprint: string, patch: DecisionPatch, opts: { always?: boolean } = {}): { ruleRows?: number } {
  validatePatch(patch);
  const row = rowFor(db, fingerprint);
  const m = merged(db, fingerprint, row, patch);
  validateMerged(m);
  const kind = (m.kind ?? kindForCategory(m.category)) as Kind | null;
  if (opts.always && !kind) throw new DecisionError(`Choose a kind or a category to make this a rule for ${row.payee}.`);
  const now = new Date().toISOString();
  let ruleId: number | null = null;
  db.transaction(() => {
    write(db, fingerprint, row, m, now);
    if (opts.always && kind) {
      const sign = row.amount_cents < 0 ? 'out' : 'in';
      db.prepare("DELETE FROM rules WHERE source = 'user' AND field = 'payee' AND lower(pattern) = lower(?) AND sign = ?").run(row.payee, sign);
      ruleId = Number(
        db
          .prepare(
            `INSERT INTO rules (source, priority, field, pattern, is_regex, sign, set_kind, set_category, set_bucket, created_at)
             VALUES ('user', 0, 'payee', ?, 0, ?, ?, ?, ?, ?)`,
          )
          .run(row.payee, sign, kind, kind === 'spend' || kind === 'income' ? m.category : null, kind === 'spend' ? m.bucket : null, now).lastInsertRowid,
      );
    }
  })();
  classifyAll(db, loadSettings(paths));
  if (ruleId === null) return {};
  const n = db.prepare('SELECT COUNT(*) n FROM transactions WHERE classified_by = ?').get(`rule:${ruleId}`) as { n: number };
  return { ruleRows: n.n };
}

/** The same decision on many rows (bulk actions), then one re-classification. */
export function setDecisions(db: Db, paths: Paths, fingerprints: string[], patch: DecisionPatch): number {
  validatePatch(patch);
  const unique = [...new Set(fingerprints)];
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const fp of unique) {
      const row = rowFor(db, fp);
      const m = merged(db, fp, row, patch);
      validateMerged(m);
      write(db, fp, row, m, now);
    }
  })();
  classifyAll(db, loadSettings(paths));
  return unique.length;
}

/** Removes your decision on a row. False when there was none. */
export function clearDecision(db: Db, paths: Paths, fingerprint: string): boolean {
  const removed = db.prepare('DELETE FROM decisions WHERE fingerprint = ?').run(fingerprint).changes > 0;
  if (removed) classifyAll(db, loadSettings(paths));
  return removed;
}

export function listRules(db: Db): RuleView[] {
  return (
    db.prepare('SELECT * FROM rules ORDER BY source DESC, id DESC').all() as {
      id: number;
      source: 'seed' | 'user';
      field: 'payee' | 'raw';
      pattern: string;
      sign: 'in' | 'out' | null;
      set_kind: string | null;
      set_category: string | null;
      set_bucket: string | null;
      created_at: string;
    }[]
  ).map((r) => ({
    id: r.id,
    source: r.source,
    field: r.field,
    pattern: r.pattern,
    sign: r.sign,
    setKind: r.set_kind,
    setCategory: r.set_category,
    setBucket: r.set_bucket,
    createdAt: r.created_at,
  }));
}

/** The seeded merchant rules (they live in code, not the database), for display. */
export function listSeedRules(): { id: string; kind: string; category: string | null; bucket: string | null }[] {
  return SEED_RULES.map((s) => ({ id: s.id, kind: s.kind, category: s.category ?? null, bucket: s.bucket ?? null }));
}

/** Deletes one of your rules. False when there was no such rule. */
export function deleteRule(db: Db, paths: Paths, id: number): boolean {
  const removed = db.prepare("DELETE FROM rules WHERE id = ? AND source = 'user'").run(id).changes > 0;
  if (removed) classifyAll(db, loadSettings(paths));
  return removed;
}
