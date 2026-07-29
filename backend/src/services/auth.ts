import { PrismaClient } from '@prisma/client';
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'crypto';

const prisma = new PrismaClient();

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';
const IV_LENGTH = 16;

function encrypt(text: string): string {
  const iv = randomBytes(IV_LENGTH);
  const key = scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

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

export async function handleOAuthCallback(code: string, state: string) {
  const { OAuth2Client } = await import('google-auth-library');
  const client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.CORS_ORIGIN || 'http://localhost:5173'}/auth/callback`
  );

  const { tokens } = await client.getToken(code);
  if (!tokens.access_token) {
    throw new Error('Failed to exchange code for tokens');
  }

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token!,
    audience: process.env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  if (!payload) {
    throw new Error('Failed to verify ID token');
  }

  const email = payload.email!;
  const displayName = payload.name || email.split('@')[0];
  const avatarUrl = payload.picture;

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

  const jwtPayload = {
    sub: user.id,
    email: user.email,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    type: 'access',
  };

  const { sign } = await import('jsonwebtoken');
  const jwt = sign(jwtPayload, process.env.JWT_SECRET || 'default-secret', { expiresIn: '1h' });

  return { user, jwt, refreshToken: tokens.refresh_token };
}

export async function getDecryptedToken(userId: string) {
  const authToken = await prisma.authToken.findUnique({ where: { user_id: userId } });
  if (!authToken) return null;

  return {
    access_token: decrypt(authToken.access_token),
    refresh_token: authToken.refresh_token ? decrypt(authToken.refresh_token) : null,
    token_expiry: authToken.token_expiry,
    scopes: authToken.scopes,
  };
}

export async function refreshAccessToken(userId: string) {
  const authToken = await prisma.authToken.findUnique({ where: { user_id: userId } });
  if (!authToken?.refresh_token) return null;

  const { OAuth2Client } = await import('google-auth-library');
  const client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  const { tokens } = await client.refreshToken(decrypt(authToken.refresh_token));

  if (!tokens.access_token) return null;

  await prisma.authToken.update({
    where: { user_id: userId },
    data: {
      access_token: encrypt(tokens.access_token!),
      refresh_token: tokens.refresh_token ? encrypt(tokens.refresh_token) : authToken.refresh_token,
      token_expiry: new Date(Date.now() + (tokens.expiry_date ? tokens.expiry_date - Date.now() : 3600000)),
    },
  });

  return tokens.access_token;
}

export async function revokeDriveAccess(userId: string, driveId: string) {
  const drive = await prisma.drive.findFirst({ where: { id: driveId, user_id: userId } });
  if (!drive) return;

  const { OAuth2Client } = await import('google-auth-library');
  const client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  try {
    const token = decrypt(drive.oauth_token_encrypted);
    await client.revokeToken(token);
  } catch {
    // Token already revoked or invalid, proceed with cleanup
  }

  await prisma.drive.delete({ where: { id: driveId } });
}

export async function getUserDrives(userId: string) {
  return prisma.drive.findMany({ where: { user_id: userId } });
}

export async function connectDrive(userId: string, driveName: string, googleDriveId: string, rootFolderId: string, oauthTokenEncrypted: string, tokenExpiry: Date) {
  return prisma.drive.create({
    data: {
      user_id: userId,
      drive_name: driveName,
      google_drive_id: googleDriveId,
      root_folder_id: rootFolderId,
      oauth_token_encrypted: oauthTokenEncrypted,
      token_expiry: tokenExpiry,
      status: 'online',
    },
  });
}