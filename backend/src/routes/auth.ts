import { Hono } from 'hono';
import { randomBytes, createHash } from 'crypto';
import { prisma } from '../db/client';

export const authRoutes = new Hono();

function getBackendUrl() {
  const port = process.env.PORT || '3000';
  return process.env.BACKEND_URL || `http://localhost:${port}`;
}

function getFrontendUrl() {
  return process.env.CORS_ORIGIN || 'http://localhost:5173';
}

const JWT_SECRET = process.env.JWT_SECRET as string;

authRoutes.get('/login', async (c) => {
  const state = randomBytes(16).toString('hex');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

  const statePayload = Buffer.from(JSON.stringify({ state, codeVerifier })).toString('base64url');

  const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  googleAuthUrl.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID || '');
  googleAuthUrl.searchParams.set('redirect_uri', `${getBackendUrl()}/api/v1/auth/callback`);
  googleAuthUrl.searchParams.set('response_type', 'code');
  googleAuthUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/drive.file');
  googleAuthUrl.searchParams.set('state', statePayload);
  googleAuthUrl.searchParams.set('code_challenge', codeChallenge);
  googleAuthUrl.searchParams.set('code_challenge_method', 'S256');
  googleAuthUrl.searchParams.set('access_type', 'offline');
  googleAuthUrl.searchParams.set('prompt', 'consent');

  return c.redirect(googleAuthUrl.toString());
});

authRoutes.get('/callback', async (c) => {
  const code = c.req.query('code');
  const stateParam = c.req.query('state');

  if (!code) {
    return c.json({ error: { code: 'INVALID_REQUEST', message: 'Authorization code missing' } }, 400);
  }

  let codeVerifier: string | undefined;
  if (stateParam) {
    try {
      const decoded = JSON.parse(Buffer.from(stateParam, 'base64url').toString());
      codeVerifier = decoded.codeVerifier;
    } catch {
      // State is a plain string or malformed — fall through
    }
  }

  try {
    const { OAuth2Client } = await import('google-auth-library');
    const client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${getBackendUrl()}/api/v1/auth/callback`
    );

    const tokenParams: any = { code };
    if (codeVerifier) {
      tokenParams.codeVerifier = codeVerifier;
    }
    const { tokens } = await client.getToken(tokenParams);

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

    let user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          display_name: displayName,
          avatar_url: avatarUrl,
          storage_mode: 'balanced',
        },
      });
    }

    const { encrypt } = await import('../utils/crypto');
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
        user_id: user.id,
        access_token: encrypt(tokens.access_token!),
        refresh_token: tokens.refresh_token ? encrypt(tokens.refresh_token) : '',
        token_expiry: new Date(Date.now() + (tokens.expiry_date ? tokens.expiry_date - Date.now() : 3600000)),
        scopes: tokens.scope?.split(' ') || [],
      },
    });

    const jwt = (await import('jsonwebtoken')).default;
    const jwtToken = jwt.sign(
      { sub: user.id, email: user.email, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, type: 'access' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    const refreshJwt = jwt.sign(
      { sub: user.id, type: 'refresh' },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    c.header('Set-Cookie', `access_token=${jwtToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600; ${c.req.url.startsWith('https') ? 'Secure;' : ''}`);
    return c.redirect(`${getFrontendUrl()}/files`);
  } catch (error: any) {
    return c.json({ error: { code: 'AUTH_ERROR', message: error?.message || 'Authentication failed' } }, 500);
  }
});

authRoutes.get('/connect', async (c) => {
  const userId = (c as any).get('userId');
  const state = randomBytes(16).toString('hex');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

  const statePayload = Buffer.from(JSON.stringify({ state, codeVerifier, connectUserId: userId })).toString('base64url');

  const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  googleAuthUrl.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID || '');
  googleAuthUrl.searchParams.set('redirect_uri', `${getBackendUrl()}/api/v1/auth/callback`);
  googleAuthUrl.searchParams.set('response_type', 'code');
  googleAuthUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/drive.file');
  googleAuthUrl.searchParams.set('state', statePayload);
  googleAuthUrl.searchParams.set('code_challenge', codeChallenge);
  googleAuthUrl.searchParams.set('code_challenge_method', 'S256');
  googleAuthUrl.searchParams.set('access_type', 'offline');
  googleAuthUrl.searchParams.set('prompt', 'consent');

  return c.json({ authUrl: googleAuthUrl.toString() });
});

authRoutes.get('/me', async (c) => {
  const userId = (c as any).get('userId');
  if (!userId) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
  }

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
  const userId = (c as any).get('userId');
  if (userId) {
    await prisma.authToken.deleteMany({ where: { user_id: userId } });
  }

  c.header('Set-Cookie', 'access_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  return c.json({ message: 'Logged out' });
});
