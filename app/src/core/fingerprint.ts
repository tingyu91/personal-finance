import { createHash } from 'node:crypto';

/**
 * A stable identity for a transaction that survives re-parsing (PRD §6): decisions are keyed
 * by it, never by row id. Only the letters of the statement text count, so reference numbers
 * and redaction rules never move it; identical rows are told apart by their occurrence.
 * Card rows also carry their post date: two identical charges on the same day can post either
 * side of a statement date, and each must survive in its own statement.
 */
export interface FingerprintParts {
  date: string;
  amountCents: number;
  raw: string;
  postDate?: string | null;
  cardLast4?: string | null;
}

export function normaliseRaw(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, '');
}

function tuple(p: FingerprintParts): string {
  return [p.date, String(p.amountCents), normaliseRaw(p.raw), p.cardLast4 ?? '', p.postDate ?? ''].join('|');
}

export function fingerprint(parts: FingerprintParts & { accountKey: string }, occurrence: number): string {
  return createHash('sha1').update(`${parts.accountKey}|${tuple(parts)}|${occurrence}`).digest('hex');
}

export function assignFingerprints<T extends FingerprintParts>(accountKey: string, rows: T[]): (T & { fingerprint: string })[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const t = tuple(row);
    const occurrence = seen.get(t) ?? 0;
    seen.set(t, occurrence + 1);
    return { ...row, fingerprint: fingerprint({ ...row, accountKey }, occurrence) };
  });
}
