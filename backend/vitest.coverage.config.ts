import { defineConfig } from 'vitest/config';

// Unit and integration tests together, which is the only run whose coverage number means
// anything: the routes and services are exercised through the HTTP app. Needs DATABASE_URL.
export default defineConfig({
  test: {
    name: 'backend-all',
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.integration.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test/**', 'src/index.ts'],
      thresholds: { lines: 70, functions: 70, branches: 75 },
    },
  },
});
