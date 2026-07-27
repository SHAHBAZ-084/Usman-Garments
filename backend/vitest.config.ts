import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globalSetup: ['./src/test-helpers/global-setup.ts'],
    setupFiles: ['./src/test-helpers/load-env.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
