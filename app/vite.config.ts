import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { LISTEN } from './src/server/listen';

// The UI is served on loopback only; /api goes to the local Hono server.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist/web', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': `http://${LISTEN.hostname}:${LISTEN.port}` },
  },
  preview: { host: '127.0.0.1' },
});
