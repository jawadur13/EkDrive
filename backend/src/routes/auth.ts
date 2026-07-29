import { Hono } from 'hono';
import { randomBytes, createHash } from 'crypto';

export const authRoutes = new Hono();

authRoutes.get('/login', async (c) => {
  const state = randomBytes(16).toString('hex');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

  const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  googleAuthUrl.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID || '');
  googleAuthUrl.searchParams.set('redirect_uri', `${process.env.CORS_ORIGIN || 'http://localhost:5173'}/auth/callback`);
  googleAuthUrl.searchParams.set('response_type', 'code');
  googleAuthUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/drive.file');
  googleAuthUrl.searchParams.set('state', state);
  googleAuthUrl.searchParams.set('code_challenge', codeChallenge);
  googleAuthUrl.searchParams.set('code_challenge_method', 'S256');
  googleAuthUrl.searchParams.set('access_type', 'offline');
  googleAuthUrl.searchParams.set('prompt', 'consent');

  return c.redirect(googleAuthUrl.toString());
});

authRoutes.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');

  if (!code) {
    return c.json({ error: { code: 'INVALID_REQUEST', message: 'Authorization code missing' } }, 400);
  }

  try {
    const { OAuth2Client } = await import('google-auth-library');
    const client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.CORS_ORIGIN || 'http://localhost:5173'}/auth/callback`
    );

    const { tokens } = await client.getToken(code);
    if (!tokens.access_token) {
      return c.json({ error: { code: 'TOKEN_ERROR', message: 'Failed to exchange code for tokens' } }, 500);
    }

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token!,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload) {
      return c.json({ error: { code: 'TOKEN_ERROR', message: 'Failed to verify ID token' } }, 500);
    }

    const email = payload.email!;
    const displayName = payload.name || email.split('@')[0];
    const avatarUrl = payload.picture;

    const prisma = (await import('../db/client')).prisma;

    let user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          displayName,
          avatarUrl,
          storage_mode: 'balanced',
        },
      });
    }

    const encrypt = (await import('../utils/crypto')).encrypt;
    await prisma.authToken.upsert({
      where: { user_id: user.id },
      create: {
        user_id: user.id,
        access_token: encrypt(tokens.access_token!),
        refresh_token: tokens.refresh_token ? encrypt(tokens.refresh_token) : '',
        token_expiry: new Date(Date.now() + (tokens.expiry_date ? tokens.expiry_date - Date.now() : 3600000)),
        scopes: tokens.scope?.split(' ') || [],
      },
      update: {
        access_token: encrypt(tokens.access_token!),
        refresh_token: tokens.refresh_token ? encrypt(tokens.refresh_token) : '',
        token_expiry: new Date(Date.now() + (tokens.expiry_date ? tokens.expiry_date - Date.now() : 3600000)),
        scopes: tokens.scope?.split(' ') || [],
      },
    });

    const jwt = (await import('jsonwebtoken')).default;
    const jwtToken = jwt.sign(
      { sub: user.id, email: user.email, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, type: 'access' },
      process.env.JWT_SECRET || 'default-secret',
      { expiresIn: '1h' }
    );

    const refreshToken = jwt.sign(
      { sub: user.id, type: 'refresh' },
      process.env.JWT_SECRET || 'default-secret',
      { expiresIn: '30d' }
    );

    const frontendUrl = `${process.env.CORS_ORIGIN || 'http://localhost:5173'}/auth/callback`;
    return c.redirect(`${frontendUrl}#access_token=${jwtToken}&refresh_token=${refreshToken}`);
  } catch (error: any) {
    return c.json({ error: { code: 'AUTH_ERROR', message: error?.message || 'Authentication failed' } }, 500);
  }
});

authRoutes.get('/connect', async (c) => {
  const state = randomBytes(16).toString('hex');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

  const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  googleAuthUrl.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID || '');
  googleAuthUrl.searchParams.set('redirect_uri', `${process.env.CORS_ORIGIN || 'http://localhost:5173'}/auth/callback`);
  googleAuthUrl.searchParams.set('response_type', 'code');
  googleAuthUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/drive.file');
  googleAuthUrl.searchParams.set('state', state);
  googleAuthUrl.searchParams.set('code_challenge', codeChallenge);
  googleAuthUrl.searchParams.set('code_challenge_method', 'S256');
  googleAuthUrl.searchParams.set('access_type', 'offline');
  googleAuthUrl.searchParams.set('prompt', 'consent');

  return c.redirect(googleAuthUrl.toString());
});

authRoutes.get('/me', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
  }

  const prisma = (await import('../db/client')).prisma;
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'User not found' } }, 404);
  }

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      storageMode: user.storage_mode,
    },
  });
});

authRoutes.post('/logout', async (c) => {
  const userId = c.get('userId');
  if (userId) {
    const prisma = (await import('../db/client')).prisma;
    await prisma.authToken.deleteMany({ where: { user_id: userId } });
  }

  return c.json({ message: 'Logged out' });
});