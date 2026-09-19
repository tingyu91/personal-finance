import { describe, it, expect } from 'vitest';
import { createApp, LISTEN } from './app';
import { getPaths } from '../config';

describe('server', () => {
  it('answers /api/health', async () => {
    const app = createApp({ paths: getPaths({}) });
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, app: 'tally' });
  });

  it('listens on loopback only', () => {
    expect(LISTEN.hostname).toBe('127.0.0.1');
  });

  it('answers unknown API routes with a 404 JSON body', async () => {
    const app = createApp({ paths: getPaths({}) });
    const res = await app.request('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });
});
