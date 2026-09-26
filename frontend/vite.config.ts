import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // The dev proxy follows the backend's own settings in the repo-root .env.local, so moving
  // the backend (PORT / BACKEND_URL) needs no change here. VITE_API_TARGET still overrides.
  const rootEnv = loadEnv(mode, fileURLToPath(new URL('..', import.meta.url)), '');
  const apiTarget =
    process.env.VITE_API_TARGET ||
    rootEnv.BACKEND_URL ||
    `http://localhost:${rootEnv.PORT || '3000'}`;

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  };
});
