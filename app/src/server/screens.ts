import fs from 'node:fs';
import type { Hono } from 'hono';
import type { Paths } from '../config';
import type { Db } from '../db/open';
import { BUCKETS, CATEGORIES, INCOME_CATEGORIES, KINDS } from '../classify/categories';
import { accountLabel } from '../core/labels';
import { addManualEntry, deleteManualEntry, ManualEntryError, type ManualEntry } from '../manual';
import { coverage } from '../reports/coverage';
import { listTransactions } from '../reports/ledger';
import { dataMonths } from '../reports/months';
import { overview } from '../reports/overview';
import { acceptStatement, listFiles, removeFile, vaultFile } from '../reports/statements';
import { loadSettings } from '../settings';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Read endpoints and statement/manual-entry actions behind the Statements, Transactions and Overview screens. */
type Serial = <T>(task: () => Promise<T>) => Promise<T>;

/** A whole number from a query string, or undefined for anything else ("abc", "2.5", "-1"). */
function count(v: string | undefined): number | undefined {
  if (!v || !/^\d+$/.test(v)) return undefined;
  return Number(v);
}

export function registerScreenRoutes(api: Hono, paths: Paths, db: () => Db, serial: Serial): void {
  api.get('/meta', (c) => {
    const settings = loadSettings(paths);
    return c.json({
      categories: CATEGORIES.map((k) => ({ name: k.name, slot: k.slot })),
      incomeCategories: INCOME_CATEGORIES,
      kinds: KINDS,
      buckets: BUCKETS,
      months: dataMonths(db()),
      aliasesSet: settings.self.aliases.length > 0,
      partnerName: settings.partner.name,
      inbox: paths.inboxDir,
    });
  });

  api.get('/accounts', (c) => {
    const rows = db()
      .prepare(
        `SELECT a.id, a.bank, a.product, a.kind, a.last4, a.currency, a.owner, a.seen_only_as_target, a.label,
                (SELECT MAX(month) FROM statements s WHERE s.account_id = a.id) last_month
         FROM accounts a ORDER BY a.seen_only_as_target, a.kind DESC, a.bank, a.product`,
      )
      .all() as { id: number; bank: string; product: string; kind: string; last4: string; currency: string; owner: string; seen_only_as_target: number; label: string | null; last_month: string | null }[];
    return c.json({
      accounts: rows.map((a) => ({
        id: a.id,
        label: accountLabel(a),
        kind: a.kind,
        owner: a.owner,
        currency: a.currency,
        seenOnly: a.seen_only_as_target === 1,
        lastMonth: a.last_month,
      })),
    });
  });

  api.get('/coverage', (c) => c.json(coverage(db())));

  api.get('/overview', (c) => {
    const asked = c.req.query('month');
    if (asked && !MONTH.test(asked)) return c.json({ error: 'Give the month as YYYY-MM.' }, 400);
    const months = dataMonths(db());
    const month = asked ?? months.at(-1);
    if (!month) return c.json({ empty: true, months: [] });
    return c.json(overview(db(), month));
  });

  api.get('/transactions', (c) => {
    const q = c.req.query();
    const accountId = q.account ? Number(q.account) : undefined;
    return c.json(
      listTransactions(db(), {
        month: q.month && MONTH.test(q.month) ? q.month : undefined,
        accountId: Number.isInteger(accountId) ? accountId : undefined,
        category: q.category || undefined,
        kind: q.kind || undefined,
        review: q.review === '1',
        q: q.q || undefined,
        limit: count(q.limit),
        offset: count(q.offset),
      }),
    );
  });

  api.get('/files', (c) => c.json({ files: listFiles(db()) }));

  api.get('/files/:id/pdf', (c) => {
    const f = vaultFile(db(), paths, Number(c.req.param('id')));
    if (!f) return c.json({ error: 'That PDF is not in the vault.' }, 404);
    return new Response(fs.readFileSync(f.full), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${f.name.replace(/[^\w.\- ]/g, '_')}"`,
        'cache-control': 'no-store',
      },
    });
  });

  // Everything that writes waits its turn behind a running import or rebuild.
  api.delete('/files/:id', async (c) => {
    const id = count(c.req.param('id'));
    if (!id) return c.json({ error: 'That is not a file number.' }, 400);
    const ok = await serial(async () => removeFile(db(), paths, id));
    return ok ? c.json({ ok: true }) : c.json({ error: 'That file is not here any more.' }, 404);
  });

  api.post('/statements/:id/accept', async (c) => {
    const id = count(c.req.param('id'));
    if (!id) return c.json({ error: 'That is not a statement number.' }, 400);
    const ok = await serial(async () => acceptStatement(db(), paths, id));
    return ok ? c.json({ ok: true }) : c.json({ error: 'That statement already reconciles, or is not here.' }, 404);
  });

  api.post('/transactions/manual', async (c) => {
    const raw: unknown = await c.req.json().catch(() => null);
    const body = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as ManualEntry;
    try {
      return c.json({ transaction: await serial(async () => addManualEntry(db(), paths, body)) });
    } catch (e) {
      if (e instanceof ManualEntryError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  api.delete('/transactions/:fingerprint', async (c) => {
    try {
      await serial(async () => deleteManualEntry(db(), paths, c.req.param('fingerprint')));
      return c.json({ ok: true });
    } catch (e) {
      if (e instanceof ManualEntryError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });
}
