import { Hono } from 'hono';
import type { Paths } from '../config';

export { LISTEN } from './listen';

export interface AppContext {
  paths: Paths;
}

export function createApp(ctx: AppContext): Hono {
  const app = new Hono();
  const api = new Hono();

  api.get('/health', (c) => c.json({ ok: true, app: 'tally' }));
  api.all('*', (c) => c.json({ error: 'Not found' }, 404));

  app.route('/api', api);
  void ctx;
  return app;
}
