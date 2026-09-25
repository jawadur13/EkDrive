import { defineConfig } from 'vitest/config';

// Runs against the real database in DATABASE_URL (.env.local). Google Drive I/O is mocked.
export default defineConfig({
  test: {
    name: 'backend-integration',
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
