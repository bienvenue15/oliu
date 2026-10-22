import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup.ts'],
    fileParallelism: false, // one database, tests run one file at a time
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
