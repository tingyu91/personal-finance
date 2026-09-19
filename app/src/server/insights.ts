import path from 'node:path';
import type { Hono } from 'hono';
import type { Paths } from '../config';
import type { Db } from '../db/open';
import { dismissInsight, listInsights, restoreInsights } from '../insights';
import { writeMonthlyReview } from '../review';
import { dataMonths } from '../reports/months';

type Serial = <T>(task: () => Promise<T>) => Promise<T>;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

async function body(req: Request): Promise<Record<string, unknown>> {
  const b: unknown = await req.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
}

/** The Insights screen: live insights, dismiss and snooze, and the monthly review file. */
export function registerInsightRoutes(api: Hono, paths: Paths, db: () => Db, serial: Serial): void {
  api.get('/insights', (c) => c.json(listInsights(db(), paths)));

  // Keys can hold any text (payees, account names), so they travel in the body, not the path.
  api.post('/insights/dismiss', async (c) => {
    const b = await body(c.req.raw);
    if (typeof b.key !== 'string' || !b.key || b.key.length > 2000) return c.json({ error: 'Say which insight to dismiss.' }, 400);
    if (b.days !== undefined && (typeof b.days !== 'number' || !Number.isInteger(b.days) || b.days < 1 || b.days > 366)) {
      return c.json({ error: 'Snooze for 1 to 366 days.' }, 400);
    }
    await serial(async () => dismissInsight(db(), b.key as string, b.days as number | undefined));
    return c.json({ ok: true });
  });

  api.post('/insights/restore', async (c) => c.json({ restored: await serial(async () => restoreInsights(db())) }));

  api.post('/review/:month', async (c) => {
    const month = c.req.param('month');
    if (!MONTH.test(month)) return c.json({ error: 'Give the month as YYYY-MM.' }, 400);
    if (!dataMonths(db()).includes(month)) return c.json({ error: 'There are no statements for that month.' }, 404);
    const file = await serial(async () => writeMonthlyReview(db(), paths, month));
    return c.json({ file: path.relative(paths.root, file).replace(/\\/g, '/') });
  });
}
