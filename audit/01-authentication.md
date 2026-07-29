# Audit — Authentication Module

Scope: Google OAuth login/callback, session/JWT, `/me`, logout, drive connect flow.

Files: `backend/src/routes/auth.ts`, `backend/src/utils/drive-auth.ts`, `backend/src/middleware/auth.ts`, `frontend/src/pages/Login.tsx`, `frontend/src/pages/AuthCallback.tsx`, `frontend/src/stores/authStore.ts`.

## Feature status

| Feature | Status | Notes |
|---|---|---|
| Google OAuth login | 🟡 Partial | Flow wired end-to-end but has correctness bugs (PKCE, redirect_uri, schema fields). |
| OAuth callback / token exchange | 🟡 Partial | Handler exists but `code_verifier` never passed; token delivery insecure. |
| Session (JWT) issuance | 🟡 Partial | JWT signed & verified, but uses hardcoded fallback secret. |
| `/me` current user | ✅ Implemented | Reads correct snake_case fields. |
| Logout | ✅ Implemented | Clears cookie. |
| Connect additional Drive | 🟡 Partial | `/connect` is a duplicate of `/login`; frontend expects JSON `authUrl` but backend redirects. |
| Refresh token handling | 🟡 Partial | `refreshAccessToken` exists but empty-string refresh tokens are persisted. |

## Bugs & issues

🐞 **PKCE verifier never used.** `codeVerifier`/`codeChallenge` are generated and `code_challenge` is sent on the auth URL (`auth.ts` lines 8-9, 115-116), but `code_verifier` is never passed to `client.getToken(code)` in `/callback` (line 41). If Google enforces PKCE the exchange fails.

🐞 **redirect_uri / handler mismatch.** `redirect_uri` is set to `${CORS_ORIGIN}/auth/callback` (frontend URL, lines 13, 38, 120), but the backend `/callback` handler (line 25) is what actually processes the code. The registered redirect and the processing endpoint diverge.

🐞 **camelCase vs snake_case on user create.** `prisma.user.create` writes `displayName`/`avatarUrl` (lines 68-69) while the schema defines `display_name`/`avatar_url`. This throws a Prisma validation error on first login. (Note `/me` at lines 149-150 reads the correct snake_case fields.)

🐞 **Dead duplication.** `/login` (line 6) and `/connect` (line 113) are byte-for-byte identical, so "connect another drive" has no distinct behavior.

⚠ **Tokens delivered via URL hash.** Callback redirects with `#access_token=...&refresh_token=...` (line 107). Tokens land in browser history and are readable by any script on the page. Should be an HttpOnly cookie or one-time code exchange.

⚠ **Hardcoded JWT fallback secret** `'default-secret'` (lines 96, 102; also `middleware/auth.ts`). If `JWT_SECRET` is unset, tokens are forgeable.

🐞 **Empty refresh token persisted.** When Google omits a refresh token, `''` is stored (lines 81, 87), which will later fail refresh silently.

⚠ **`getOAuthClient` never sets credentials** (`utils/drive-auth.ts` line 35). Returns an unauthenticated client — this is the root cause of all downstream Drive API failures (see Storage/Upload/Download modules).

⚠ **Hardcoded crypto salt** `'salt'` in `decrypt()` (`utils/drive-auth.ts` line 15). Weakens token-at-rest encryption.

## Frontend

- `Login.tsx` / `AuthCallback.tsx` work with the backend hash-redirect flow (consistent, but inherits the insecurity above).
- `authStore.ts` reads token from cookie, calls `/auth/me`, redirects on 401 — correct.

## Verdict
Authentication is the most complete module but is **not production-ready**: token delivery is insecure, the user-create call will throw on schema mismatch, and PKCE is effectively disabled.
