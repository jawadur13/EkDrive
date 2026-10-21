// Loads .env.local the way the app does, so a run that needs a real database (the
// integration suite, and the combined coverage run) gets the configured one.
import '../env';

// Fallbacks for unit tests, which must work with no .env.local at all. Nothing here
// overrides a value that is already set.
process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:1/test';
process.env.JWT_SECRET ??= 'test-jwt-secret';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key';
process.env.ENCRYPTION_SALT ??= 'test-salt';
process.env.GOOGLE_CLIENT_ID ??= 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET ??= 'test-client-secret';
process.env.CHUNK_SIZE_BYTES ??= '100';
