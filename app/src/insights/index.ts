import type { Paths } from '../config';
import type { Db } from '../db/open';
import { addDays, sgtDate } from '../core/dates';
import { runRules, type InsightItem } from './rules';
import { snapshot } from './snapshot';

export type { InsightItem } from './rules';

/**
 * Live insights (PRD §7.4 screen 4): every rule's findings, less the ones you dismissed and the
 * ones snoozed until a later date. A dismissed finding comes back only as a new finding.
 */
export function listInsights(db: Db, paths: Paths, today = sgtDate(new Date().toISOString())): { insights: InsightItem[]; hidden: number } {
  const all = runRules(snapshot(db, paths, today));
  const hidden = new Map(
    (db.prepare('SELECT key, until FROM dismissed_insights').all() as { key: string; until: string | null }[]).map((d) => [d.key, d.until]),
  );
  const live = all.filter((i) => {
    if (!hidden.has(i.key)) return true;
    const until = hidden.get(i.key);
    return until !== null && until !== undefined && until <= today;
  });
  return { insights: live, hidden: all.length - live.length };
}

/** Dismiss for good (days omitted) or snooze for a number of days. */
export function dismissInsight(db: Db, key: string, days?: number, today = sgtDate(new Date().toISOString())): void {
  const until = days === undefined ? null : addDays(today, days);
  db.prepare(
    `INSERT INTO dismissed_insights (key, until, created_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET until = excluded.until, created_at = excluded.created_at`,
  ).run(key, until, new Date().toISOString());
}

/** Brings back every insight you dismissed or snoozed. */
export function restoreInsights(db: Db): number {
  return db.prepare('DELETE FROM dismissed_insights').run().changes;
}

/** The rows behind one insight, for the Transactions filter. Null when no live insight has that key. */
export function insightFingerprints(db: Db, paths: Paths, key: string, today?: string): { title: string; fingerprints: string[] } | null {
  const found = runRules(snapshot(db, paths, today)).find((i) => i.key === key);
  return found ? { title: found.title, fingerprints: found.fingerprints } : null;
}
