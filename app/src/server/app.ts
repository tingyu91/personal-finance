import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import type { Paths } from '../config';
import type { Db } from '../db/open';
import { findPdfs, importFiles, type ImportDeps, type ImportFile } from '../import/importer';

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

  api.all('*', (c) => c.json({ error: 'Not found' }, 404));
  app.route('/api', api);
  return app;
}
