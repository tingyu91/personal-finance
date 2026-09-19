import fs from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { ensureDirs, getPaths } from '../config';
import { openDb } from '../db/open';
import { createApp, LISTEN } from './app';

const paths = getPaths();
ensureDirs(paths);
const db = openDb(paths.dbFile);

const app = createApp({ paths, db });

if (process.argv.includes('--static')) {
  // npm start: serve the built UI from dist/web, falling back to index.html.
  const webRoot = path.relative(process.cwd(), path.join(paths.root, 'app', 'dist', 'web'));
  app.use('/*', serveStatic({ root: webRoot }));
  app.get('*', (c) => c.html(fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8')));
}

serve({ fetch: app.fetch, hostname: LISTEN.hostname, port: LISTEN.port }, (info) => {
  const url = `http://${LISTEN.hostname}:${info.port}`;
  console.log(process.argv.includes('--static') ? `Tally is running at ${url}` : `Tally API on ${url}`);
});
