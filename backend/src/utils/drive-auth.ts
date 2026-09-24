import { env } from '../env';
import { google, drive_v3, type Auth } from 'googleapis';
import type { Drive } from '@prisma/client';
import { prisma } from '../db/client';
import { decrypt, encrypt } from './crypto';

export const GOOGLE_SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file'];

export function getOAuthRedirectUri() {
  return `${env.backendUrl}/api/v1/auth/callback`;
}

export function createOAuthClient(): Auth.OAuth2Client {
  return new google.auth.OAuth2(env.googleClientId, env.googleClientSecret, getOAuthRedirectUri());
}

// Builds an OAuth client from the drive's own stored tokens. google-auth-library refreshes
// the access token when it expires; the refreshed token is written back so the next
// request does not refresh again.
export function getDriveOAuthClient(drive: Pick<Drive, 'id' | 'oauth_token_encrypted' | 'refresh_token_encrypted' | 'token_expiry'>): Auth.OAuth2Client {
  if (!drive.oauth_token_encrypted) {
    throw new DriveAuthError('Drive has no stored credentials; reconnect it');
  }

  const client = createOAuthClient();
  client.setCredentials({
    access_token: decrypt(drive.oauth_token_encrypted),
    refresh_token: drive.refresh_token_encrypted ? decrypt(drive.refresh_token_encrypted) : undefined,
    expiry_date: drive.token_expiry?.getTime(),
  });

  client.on('tokens', (tokens) => {
    if (!tokens.access_token) return;
    prisma.drive
      .update({
        where: { id: drive.id },
        data: {
          oauth_token_encrypted: encrypt(tokens.access_token),
          ...(tokens.refresh_token ? { refresh_token_encrypted: encrypt(tokens.refresh_token) } : {}),
          token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        },
      })
      .catch((error) => console.error(`Failed to persist refreshed token for drive ${drive.id}:`, error));
  });

  return client;
}

export function getDriveApi(drive: Parameters<typeof getDriveOAuthClient>[0]): drive_v3.Drive {
  return google.drive({ version: 'v3', auth: getDriveOAuthClient(drive) });
}

export class DriveAuthError extends Error {}
