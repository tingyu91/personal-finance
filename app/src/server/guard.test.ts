import { describe, it, expect } from 'vitest';
import { createApp } from './app';
import { getPaths } from '../config';

const app = createApp({ paths: getPaths({}) });

describe('local-only guard', () => {
  it('answers requests addressed to this computer', async () => {
    for (const host of ['127.0.0.1:5317', 'localhost:5173', '127.0.0.1']) {
      const res = await app.request('/api/health', { headers: { host } });
      expect(res.status, host).toBe(200);
    }
  });

  it('refuses a request addressed to another host name (DNS rebinding)', async () => {
    const res = await app.request('/api/health', { headers: { host: 'evil.example:5317' } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Tally only answers requests made on this computer.' });
  });

  it('refuses a change sent from another website', async () => {
    const res = await app.request('/api/import/inbox', { method: 'POST', headers: { host: '127.0.0.1:5317', origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Blocked a request from another website.' });
  });

  it('accepts a change sent from the app itself', async () => {
    const res = await app.request('/api/nope', { method: 'POST', headers: { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173' } });
    expect(res.status).toBe(404);
  });
});
