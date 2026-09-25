// Deterministic values for unit tests; nothing here touches a real database or Google.
process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:1/test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.ENCRYPTION_KEY = 'test-encryption-key';
process.env.ENCRYPTION_SALT = 'test-salt';
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.CHUNK_SIZE_BYTES = '100';
