# EkDrive — Authentication & Authorization

## 1. Authentication Flow

### 1.1 Google OAuth 2.0 (Authorization Code with PKCE)

EkDrive uses Google OAuth 2.0 to authenticate users and obtain access to their Google Drive accounts. The flow is as follows:

```
1. User clicks "Connect Google Drive" in the UI
2. Frontend initiates OAuth flow:
   a. Generate code_verifier (random string, 43-128 chars)
   b. Derive code_challenge = BASE64URL(SHA256(code_verifier))
   c. Redirect to Google OAuth consent screen:
      - response_type=code
      - client_id=<EKDRIVE_CLIENT_ID>
      - redirect_uri=https://app.ekdrive.io/auth/callback
      - scope=https://www.googleapis.com/auth/drive.file
      - state=<random CSRF token>
      - code_challenge=<code_challenge>
      - code_challenge_method=S256
3. User grants consent
4. Google redirects to /auth/callback with:
   - code (authorization code)
   - state (CSRF token, validated)
5. Backend exchanges code for tokens:
   POST https://oauth2.googleapis.com/token
   - code
   - client_id
   - client_secret
   - redirect_uri
   - grant_type=authorization_code
   - code_verifier
6. Google returns:
   - access_token (short-lived, ~1 hour)
   - refresh_token (long-lived)
   - id_token (JWT with user info)
   - expires_in
7. Backend:
   a. Validates id_token (issuer, audience, expiry)
   b. Extracts user info (sub, email, name, picture)
   c. Creates or updates user record in PostgreSQL
   d. Encrypts and stores access_token + refresh_token
   e. Issues EkDrive JWT for the session
8. Frontend stores JWT in httpOnly, secure, SameSite=Strict cookie
```

### 1.2 Connecting Additional Google Drive Accounts

Users can connect multiple Google Drive accounts:

```
1. User goes to Settings → Connected Drives → "Add Drive"
2. Same OAuth flow as above, but:
   - The user may select a different Google account in the consent screen
   - The new drive is associated with the same user_id
3. Backend stores a new drive record with its own encrypted OAuth token
4. The drive appears in the unified storage pool immediately
```

### 1.3 Token Management

| Concern | Strategy |
|---|---|
| **Access Token Expiry** | Refreshed automatically using the refresh token before each Drive API call. If refresh fails, trigger re-authentication. |
| **Refresh Token Rotation** | Google rotates refresh tokens on each use. EkDrive stores the latest refresh token and overwrites the previous one. |
| **Encryption at Rest** | OAuth tokens are encrypted using AES-256-GCM with a per-user encryption key derived from the user's password hash (or a system-level key managed by a KMS). |
| **Token Revocation** | When a user disconnects a drive, the backend revokes the OAuth token with Google's revocation endpoint and deletes the encrypted token from the database. |
| **Token Refresh Scheduling** | A background job refreshes tokens that are within 5 minutes of expiry. |

## 2. Session Management

### 2.1 JWT Structure

```json
{
  "sub": "user-uuid",
  "email": "user@example.com",
  "iat": 1700000000,
  "exp": 1700003600,
  "type": "access",
  "mfa": false
}
```

- **Access Token**: Short-lived (1 hour), sent with every request.
- **Refresh Token**: Long-lived (30 days), stored in an httpOnly cookie. Used to obtain new access tokens without re-authentication.
- **Refresh Token Rotation**: Each time a refresh token is used, a new refresh token is issued and the old one is invalidated.

### 2.2 Cookie Configuration

| Property | Value |
|---|---|
| `httpOnly` | true |
| `secure` | true (HTTPS only) |
| `SameSite` | Strict |
| `path` | / |
| `maxAge` | 30 days (refresh token), 1 hour (access token in memory only) |

### 2.3 Session Revocation

- User can revoke all sessions from Settings → Security.
- Admin can revoke sessions for any user.
- Revocation invalidates the refresh token in the database and clears the cookie on the client.

## 3. Authorization

### 3.1 Multi-Tenancy Model

- Every database record is scoped to a `user_id`.
- All queries include `WHERE user_id = :current_user_id`.
- The authorization middleware validates that the authenticated user owns the resource before allowing access.

### 3.2 Resource-Level Permissions

| Resource | Owner | Access |
|---|---|---|
| Files/Folders | User who created them | Owner only (no sharing of virtual filesystem items) |
| Share Links | Owner of the file | Anyone with the link (subject to permissions) |
| Connected Drives | User who connected them | Owner only |
| Storage Settings | User | Owner only |

### 3.3 API Authorization Middleware

```
Request → Extract JWT from cookie → Verify signature → Extract user_id
  → Look up user in database → Check resource ownership (if applicable)
  → Attach user context to request → Pass to handler
```

### 3.4 Google Drive API Permissions

- The `drive.file` scope restricts access to files created or opened by the app.
- This is a security best practice: EkDrive cannot see or modify files the user hasn't explicitly opened through EkDrive.
- When a user connects a drive, EkDrive creates a root folder in that account and manages all files within it.

## 4. Security Considerations

| Concern | Mitigation |
|---|---|
| **CSRF** | State parameter in OAuth flow; SameSite=Strict cookies; CSRF tokens for state-changing operations |
| **XSS** | httpOnly cookies prevent JavaScript access; Content-Security-Policy headers; input sanitization |
| **Token Leakage** | Tokens encrypted at rest; never logged; never exposed to the client (except in memory for API calls) |
| **Brute Force** | Rate limiting on auth endpoints; account lockout after 5 failed attempts |
| **OAuth Redirect URI Manipulation** | Strict allowlist of redirect URIs registered with Google Cloud Console |
| **Session Fixation** | New session ID issued after authentication |
| **Token Replay** | JWT has short expiry; refresh token rotation invalidates old tokens |