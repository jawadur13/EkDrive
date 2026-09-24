import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

// Loaded here, and imported first by every module that reads process.env, so values
// are in place before any module captures them. ESM evaluates imports before the
// importing module's body, so calling dotenv.config() inside index.ts is too late.
// Resolved from this file (src/env.ts or the bundled dist/index.js — both two levels
// below the repo root), not the working directory.
dotenv.config({ path: fileURLToPath(new URL('../../.env.local', import.meta.url)), quiet: true });
dotenv.config({ quiet: true });

const REQUIRED = [
  'DATABASE_URL',
  'JWT_SECRET',
  'ENCRYPTION_KEY',
  'ENCRYPTION_SALT',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
] as const;

export function assertEnv() {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`FATAL: missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

export const env = {
  get jwtSecret() {
    return process.env.JWT_SECRET as string;
  },
  get googleClientId() {
    return process.env.GOOGLE_CLIENT_ID as string;
  },
  get googleClientSecret() {
    return process.env.GOOGLE_CLIENT_SECRET as string;
  },
  get frontendUrl() {
    return process.env.CORS_ORIGIN || 'http://localhost:5173';
  },
  get backendUrl() {
    return process.env.BACKEND_URL || `http://localhost:${process.env.PORT || '3000'}`;
  },
  get port() {
    return parseInt(process.env.PORT || '3000');
  },
  get chunkSize() {
    return parseInt(process.env.CHUNK_SIZE_BYTES || '52428800');
  },
  get rateLimitMax() {
    return parseInt(process.env.RATE_LIMIT_MAX || '100');
  },
  get trustProxy() {
    return process.env.TRUST_PROXY === 'true';
  },
  get secureCookies() {
    return this.backendUrl.startsWith('https://');
  },
};
