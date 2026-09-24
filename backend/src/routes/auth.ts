import { env } from '../env';
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { randomBytes, createHash } from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../db/client';
import { createOAuthClient, GOOGLE_SCOPES, getOAuthRedirectUri } from '../utils/drive-auth';
import { DriveOwnershipError, upsertConnectedDrive } from '../services/drives';
import { getStorageMode } from '../services/storage-mode';
import { logActivity } from '../services/activity';
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from '../middleware/auth';

export const authRoutes = new Hono();

const STATE_COOKIE = 'oauth_state';
const STATE_TTL_SECONDS = 10 * 60;

type OAuthState = {
  state: string;
  codeVerifier: string;
  mode: 'login' | 'connect';
  userId?: string;
};

// The PKCE verifier and the expected state stay server-side in a signed, HttpOnly cookie;
// only the random state value travels through Google.
function beginOAuth(c: any, mode: OAuthState['mode'], userId?: string) {
  const state = randomBytes(16).toString('hex');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

  const payload: OAuthState = { state, codeVerifier, mode, userId };
  setCookie(c, STATE_COOKIE, jwt.sign(payload, env.jwtSecret, { expiresIn: STATE_TTL_SECONDS }), {
    path: '/api/v1/auth',
    httpOnly: true,
    sameSite: 'Lax',
    secure: env.secureCookies,
    maxAge: STATE_TTL_SECONDS,
  });

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', env.googleClientId);
  url.searchParams.set('redirect_uri', getOAuthRedirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_SCOPES.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent select_account');
  return url.toString();
}

authRoutes.get('/login', (c) => c.redirect(beginOAuth(c, 'login')));

// Adds another Google account as a drive for the signed-in user. Returns JSON so the SPA
// can navigate; the state cookie is set on this response.
authRoutes.get('/connect', (c) => {
  const userId = (c as any).get('userId') as string;
  return c.json({ authUrl: beginOAuth(c, 'connect', userId) });
});

authRoutes.get('/callback', async (c) => {
  const stateCookie = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: '/api/v1/auth' });

  let pending: OAuthState | null = null;
  try {
    pending = stateCookie ? (jwt.verify(stateCookie, env.jwtSecret) as OAuthState) : null;
  } catch {
    pending = null;
  }

  const fail = (reason: string) => {
    const page = pending?.mode === 'connect' ? 'settings' : 'login';
    return c.redirect(`${env.frontendUrl}/${page}?error=${reason}`);
  };

  if (c.req.query('error')) return fail('access_denied');

  const code = c.req.query('code');
  if (!pending || !code || c.req.query('state') !== pending.state) {
    return fail('invalid_state');
  }

  try {
    const client = createOAuthClient();
    const { tokens } = await client.getToken({ code, codeVerifier: pending.codeVerifier });
    if (!tokens.access_token || !tokens.id_token) return fail('token_error');

    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env.googleClientId });
    const payload = ticket.getPayload();
    if (!payload?.email || !payload.email_verified) return fail('unverified_email');

    if (pending.mode === 'connect') {
      const user = pending.userId ? await prisma.user.findUnique({ where: { id: pending.userId } }) : null;
      if (!user) return fail('session_expired');
      await upsertConnectedDrive(user.id, tokens, payload.email);
      await logActivity(user.id, 'drive.connected', null, { drive: payload.email });
      return c.redirect(`${env.frontendUrl}/settings?connected=1`);
    }

    const user = await prisma.user.upsert({
      where: { email: payload.email },
      create: {
        email: payload.email,
        display_name: payload.name || payload.email.split('@')[0],
        avatar_url: payload.picture,
      },
      update: { display_name: payload.name || undefined, avatar_url: payload.picture },
    });

    // The account used to sign in is also the user's first drive.
    await upsertConnectedDrive(user.id, tokens, payload.email);

    const session = jwt.sign({ sub: user.id, type: 'session' }, env.jwtSecret, { expiresIn: SESSION_TTL_SECONDS });
    setCookie(c, SESSION_COOKIE, session, {
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      secure: env.secureCookies,
      maxAge: SESSION_TTL_SECONDS,
    });
    return c.redirect(`${env.frontendUrl}/files`);
  } catch (error) {
    if (error instanceof DriveOwnershipError) return fail('drive_in_use');
    console.error('OAuth callback failed:', error);
    return fail('auth_failed');
  }
});

authRoutes.get('/me', async (c) => {
  const userId = (c as any).get('userId') as string;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'User not found' } }, 404);
  }
  const mode = await getStorageMode(userId);

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      storageMode: mode.mode,
    },
  });
});

authRoutes.post('/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: env.secureCookies });
  return c.json({ message: 'Logged out' });
});
