import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts', 'web/**/*.test.tsx', 'test/**/*.test.ts'],
    environment: 'node',
    // Real-statement tests parse PDFs; give them room.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
