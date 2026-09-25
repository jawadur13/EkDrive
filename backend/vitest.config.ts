import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'backend',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'node_modules/**'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
