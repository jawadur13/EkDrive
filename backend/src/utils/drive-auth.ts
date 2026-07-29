import { OAuth2Client } from 'google-auth-library';
import { PrismaClient } from '@prisma/client';
import { createDecipheriv, scryptSync } from 'crypto';

const prisma = new PrismaClient();

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';
const IV_LENGTH = 16;

function decrypt(encryptedText: string): string {
  const parts = encryptedText.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  const key = scryptSync(ENCRYPTION_KEY, 'salt', 32);
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

export function getOAuthClient(userId: string): OAuth2Client {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.CORS_ORIGIN || 'http://localhost:5173'}/auth/callback`
  );
}

export async function refreshAccessToken(userId: string): Promise<string | null> {
  const authToken = await prisma.authToken.findUnique({ where: { user_id: userId } });
  if (!authToken?.refresh_token) return null;

  const client = getOAuthClient(userId);
  try {
    const { tokens } = await client.refreshToken(decrypt(authToken.refresh_token));
    if (!tokens.access_token) return null;

    const { encrypt } = await import('./crypto');
    await prisma.authToken.update({
      where: { user_id: userId },
      data: {
        access_token: encrypt(tokens.access_token!),
        refresh_token: tokens.refresh_token ? encrypt(tokens.refresh_token) : authToken.refresh_token,
        token_expiry: new Date(Date.now() + (tokens.expiry_date ? tokens.expiry_date - Date.now() : 3600000)),
      },
    });

    return tokens.access_token;
  } catch {
    return null;
  }
}