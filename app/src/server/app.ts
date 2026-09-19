import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import type { Paths } from '../config';
import type { Db } from '../db/open';
import { findPdfs, importFiles, type ImportDeps, type ImportFile } from '../import/importer';
import { rebuildFromVault } from '../import/rebuild';
import { clearDecision, DecisionError, deleteRule, listRules, listSeedRules, setDecision, setDecisions, type DecisionPatch } from '../decisions';
import { getTransaction } from '../queries/transactions';

/** A JSON object body, or {} for anything else (null, arrays, malformed JSON). */
async function readObject(req: Request): Promise<Record<string, unknown>> {
  const body: unknown = await req.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

/** Only the fields a decision may change; anything else in a request body is ignored. */
function pick(p: DecisionPatch): DecisionPatch {
  const out: DecisionPatch = {};
  for (const k of ['kind', 'category', 'bucket', 'vendor', 'note'] as const) if (k in p) (out as Record<string, unknown>)[k] = p[k];
  return out;
}

export { LISTEN } from './listen';

export interface AppContext {
  paths: Paths;
  db?: Db;
  importDeps?: ImportDeps;
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

function hostName(hostHeader: string): string {
  return hostHeader.replace(/:\d+$/, '').toLowerCase();
}

function isLocalOrigin(origin: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function createApp(ctx: AppContext): Hono {
  const app = new Hono();
  const api = new Hono();

  const db = (): Db => {
    if (!ctx.db) throw new Error('No database');
    return ctx.db;
  };

  // Listening on 127.0.0.1 is not enough on its own: a website open in the same browser can
  // still send requests here. Refuse other host names (DNS rebinding) and cross-site changes.
  api.use('*', async (c, next) => {
    const host = c.req.header('host');
    if (host && !LOCAL_HOSTS.has(hostName(host))) return c.json({ error: 'Tally only answers requests made on this computer.' }, 403);
    const origin = c.req.header('origin');
    if (!['GET', 'HEAD'].includes(c.req.method) && origin && !isLocalOrigin(origin)) {
      return c.json({ error: 'Blocked a request from another website.' }, 403);
    }
    await next();
  });

  // One import at a time: two drops racing on the same file must not collide.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  api.get('/health', (c) => c.json({ ok: true, app: 'tally' }));

  // Drop zone: multipart "files" (any number of PDFs) and an optional "password" for a locked one.
  api.post('/import', async (c) => {
    const body = await c.req.parseBody({ all: true });
    const raw = body['files'];
    const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((f): f is File => typeof f !== 'string');
    if (!list.length) return c.json({ error: 'Choose at least one PDF to import.' }, 400);
    const password = typeof body['password'] === 'string' && body['password'] ? body['password'] : undefined;
    const files: ImportFile[] = [];
    for (const f of list) files.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()), password });
    return c.json(await serial(() => importFiles(db(), ctx.paths, files, ctx.importDeps)));
  });

  // "Scan inbox": every PDF under inputs/statements/ (read only).
  api.post('/import/inbox', async (c) => {
    const found = findPdfs(ctx.paths.inboxDirs);
    if (!found.length) return c.json({ items: [], summary: `No PDFs in the inbox. Put statements in ${ctx.paths.inboxDir} and scan again.` });
    const files = found.map((p) => ({ name: path.basename(p), data: new Uint8Array(fs.readFileSync(p)) }));
    return c.json(await serial(() => importFiles(db(), ctx.paths, files, ctx.importDeps)));
  });

  // Decisions: one row, many rows, undo. "always" also makes a rule for the row's payee.
  // They wait behind a running import or rebuild, like everything else that writes.
  api.patch('/transactions/:fingerprint', async (c) => {
    const body = await readObject(c.req.raw);
    const fingerprint = c.req.param('fingerprint');
    const { always, ...patch } = body as DecisionPatch & { always?: unknown };
    try {
      // The row is looked up in the queue too: a rebuild ahead of this request may remove it.
      const res = await serial(async () =>
        getTransaction(db(), fingerprint) ? setDecision(db(), ctx.paths, fingerprint, pick(patch), { always: always === true }) : null,
      );
      if (!res) return c.json({ error: 'That transaction is not here any more.' }, 404);
      return c.json({ transaction: getTransaction(db(), fingerprint), ...res });
    } catch (e) {
      if (e instanceof DecisionError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  api.post('/transactions/bulk', async (c) => {
    const body = (await readObject(c.req.raw)) as { fingerprints?: unknown; patch?: unknown };
    const fps = Array.isArray(body.fingerprints) ? body.fingerprints.filter((f): f is string => typeof f === 'string') : [];
    if (!fps.length) return c.json({ error: 'Choose at least one transaction.' }, 400);
    const patch = body.patch && typeof body.patch === 'object' ? (body.patch as DecisionPatch) : {};
    try {
      return c.json({ updated: await serial(async () => setDecisions(db(), ctx.paths, fps, pick(patch))) });
    } catch (e) {
      if (e instanceof DecisionError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  api.delete('/transactions/:fingerprint/decision', async (c) => {
    const fingerprint = c.req.param('fingerprint');
    const removed = await serial(async () => clearDecision(db(), ctx.paths, fingerprint));
    if (!removed) return c.json({ error: 'There is no decision on that transaction.' }, 404);
    return c.json({ transaction: getTransaction(db(), fingerprint) });
  });

  api.get('/rules', (c) => c.json({ rules: listRules(db()), seeds: listSeedRules() }));
  api.delete('/rules/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'That is not a rule number.' }, 400);
    const removed = await serial(async () => deleteRule(db(), ctx.paths, id));
    return removed ? c.json({ ok: true }) : c.json({ error: 'That rule is not here any more.' }, 404);
  });

  api.post('/rebuild', async (c) => c.json(await serial(() => rebuildFromVault(db(), ctx.paths, ctx.importDeps))));

  api.all('*', (c) => c.json({ error: 'Not found' }, 404));
  app.route('/api', api);
  return app;
}
