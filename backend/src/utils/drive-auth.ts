import { OAuth2Client } from 'google-auth-library';
import { PrismaClient } from '@prisma/client';
import { createDecipheriv, scryptSync } from 'crypto';

const prisma = new PrismaClient();

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';
const ENCRYPTION_SALT = process.env.ENCRYPTION_SALT || 'default-salt-change-me';
const IV_LENGTH = 16;

function decrypt(encryptedText: string): string {
  const parts = encryptedText.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  const key = scryptSync(ENCRYPTION_KEY, ENCRYPTION_SALT, 32);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export async function getDecryptedTokens(userId: string) {
  const authToken = await prisma.authToken.findUnique({ where: { user_id: userId } });
  if (!authToken) return null;

  return {
    access_token: decrypt(authToken.access_token),
    refresh_token: authToken.refresh_token ? decrypt(authToken.refresh_token) : null,
    token_expiry: authToken.token_expiry,
    scopes: authToken.scopes,
  };
}

export function getOAuthClient(accessToken: string, refreshToken?: string | null): OAuth2Client {
  const client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.CORS_ORIGIN || 'http://localhost:5173'}/auth/callback`
  );
  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken || undefined,
  });
  return client;
}

export async function createAuthenticatedDriveClient(userId: string): Promise<{ client: OAuth2Client; tokens: Awaited<ReturnType<typeof getDecryptedTokens>> }> {
  const tokens = await getDecryptedTokens(userId);
  if (!tokens?.access_token) {
    return { client: new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET), tokens: null };
  }
  return { client: getOAuthClient(tokens.access_token, tokens.refresh_token), tokens };
}

export async function refreshAccessToken(userId: string): Promise<string | null> {
  const authToken = await prisma.authToken.findUnique({ where: { user_id: userId } });
  if (!authToken?.refresh_token) return null;

  const client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  client.setCredentials({ refresh_token: decrypt(authToken.refresh_token) });

  try {
    const response = await client.getAccessToken();
    if (!response?.token) return null;

    const { encrypt } = await import('./crypto');
    await prisma.authToken.update({
      where: { user_id: userId },
      data: {
        access_token: encrypt(response.token),
        refresh_token: authToken.refresh_token,
        token_expiry: new Date(Date.now() + 3600000),
      },
    });

    return response.token;
  } catch {
    return null;
  }
}
