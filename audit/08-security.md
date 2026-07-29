# Audit — Security

Legend: ✅ Fully implemented · 🟡 Partial · ❌ Missing/Planned · 🐞 Bug · ⚠ Critical

## Feature Status

| Concern | Status | Notes |
|---|---|---|
| JWT auth middleware | 🟡 | Real verification, but hardcoded fallback secret |
| OAuth token encryption at rest | 🟡 | AES-256-GCM used, but hardcoded scrypt salt |
| Token decryption | 🟡 | Works, but duplicated inline in multiple files |
| Rate limiting | ❌ | Middleware is a no-op stub |
| Security headers (helmet) | 🐞 | `helmet` is Express middleware, incompatible with Hono |
| PKCE for OAuth | 🐞 | `code_verifier` generated but never passed to `getToken` |
| CSRF protection | ❌ | Not implemented |
| Input validation (zod) | 🟡 | `zod` present but inconsistently applied |
| Secrets management | ⚠ | Hardcoded fallbacks for JWT secret and crypto salt |
| Token transport | ⚠ | JWT delivered via URL hash fragment |
| Authorization (ownership checks) | 🟡 | Some `user_id` filters; share access unguarded |

## Critical findings

- ⚠ **Hardcoded JWT fallback secret.** [middleware/auth.ts](file:///d:/Projects/EkDrive/backend/src/middleware/auth.ts) falls back to `'default-secret'` when `JWT_SECRET` is unset. In any environment missing the env var, all tokens are signable by anyone.
- ⚠ **Hardcoded crypto salt.** Both [drive-auth.ts](file:///d:/Projects/EkDrive/backend/src/utils/drive-auth.ts) and the inline decrypt in [services/files.ts](file:///d:/Projects/EkDrive/backend/src/services/files.ts#L142) derive the key with `scryptSync(KEY, 'salt', 32)`. A static salt defeats scrypt's purpose and makes all installs share the same key-derivation path.
- ⚠ **Tokens via URL hash.** [auth.ts](file:///d:/Projects/EkDrive/backend/src/routes/auth.ts) returns the JWT in the redirect URL's hash fragment. This leaks into browser history and is a fragile transport vs. an HttpOnly cookie.
- ⚠ **PKCE broken.** A `code_verifier` is generated but never supplied to `getToken()`, so PKCE provides no protection — the flow degrades to plain authorization-code.
- ⚠ **Rate limiting absent.** [middleware/rate-limit.ts](file:///d:/Projects/EkDrive/backend/src/middleware/rate-limit.ts) is a 3-line stub with no logic. Auth and upload endpoints are unthrottled → brute-force / abuse exposure.
- ⚠ **helmet misused.** [index.ts](file:///d:/Projects/EkDrive/backend/src/index.ts) wires Express `helmet`, which does not function as Hono middleware — security headers (CSP, HSTS, X-Frame-Options) are effectively **not set**.

## Authorization

- 🟡 Most file queries filter by `user_id`, but:
  - 🐞 [updateFile()](file:///d:/Projects/EkDrive/backend/src/services/files.ts#L85-L87) uses `prisma.file.update({ where: { id, user_id } })` — Prisma `update` requires a unique `where`; `user_id` is not part of the unique key, so this throws / bypasses the ownership guard.
  - ⚠ Share access ([shares.ts](file:///d:/Projects/EkDrive/backend/src/routes/shares.ts)) returns placeholders with no ownership/expiry/revocation checks.
- No role model; no admin boundary (may be acceptable for single-user scope, but undocumented).

## Data & transport

- CORS origin read from env; acceptable.
- No CSRF token on state-changing routes (mitigated somewhat if moving to header-based JWT, but cookie-based flow would need it).
- ⚠ `getOAuthClient()` never calls `.setCredentials()` — beyond breaking functionality, it means Drive calls would fail rather than act with wrong creds (fails safe, but non-functional).

## Validation & error handling

- 🟡 `zod` is a dependency but validation is not consistently applied at route boundaries.
- Error handling is uneven: some services `throw new Error()` with no route-level catch, risking unhandled 500s and stack leakage.

**Verdict:** Multiple critical, production-blocking security issues. The auth *mechanism* is real but undermined by hardcoded secrets/salt, broken PKCE, absent rate limiting, and non-functional security headers. **Not production-ready.**
