import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'frontend',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
