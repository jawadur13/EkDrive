# EkDrive — Production Readiness Audit Summary

This document aggregates the findings from the nine module audits (01–09) into a single production-readiness verdict.

**Overall verdict: NOT production ready.** The project is an early-stage prototype. The backend contains two disconnected layers — real service implementations (`services/*.ts`) and placeholder route handlers (`routes/*.ts`) — and the routes largely do not call the services. As a result most advertised features are non-functional end-to-end.

Related module reports:
- [01 — Authentication](file:///d:/Projects/EkDrive/audit/01-authentication.md)
- [02 — File & Folder Management](file:///d:/Projects/EkDrive/audit/02-file-folder-management.md)
- [03 — Upload & Download](file:///d:/Projects/EkDrive/audit/03-upload-download.md)
- [04 — Storage, Drives & Chunking](file:///d:/Projects/EkDrive/audit/04-storage-drives-chunking.md)
- [05 — Sync, Health & Trash](file:///d:/Projects/EkDrive/audit/05-sync-health-trash.md)
- [06 — Search, Sharing & Activity](file:///d:/Projects/EkDrive/audit/06-search-sharing-activity.md)
- [07 — Settings, Analytics & Notifications](file:///d:/Projects/EkDrive/audit/07-settings-analytics-notifications.md)
- [08 — Security](file:///d:/Projects/EkDrive/audit/08-security.md)
- [09 — Frontend & Dashboard](file:///d:/Projects/EkDrive/audit/09-frontend-dashboard.md)

---

## ✅ Fully Implemented Features

Very few features work end-to-end. Confirmed working / substantially complete units:

- **Google OAuth login/callback UI flow (frontend)** — Login and `/auth/callback` pages exist and handle the redirect round-trip.
- **Chunking engine (`services/chunking.ts`)** — Solid, self-contained implementation of split/checksum logic (xxhash-wasm). The algorithm itself is sound, though it is not wired into a working upload path.
- **Prisma schema baseline** — Core models (User, Drive, File, Folder, Chunk) exist and migrate, providing a usable foundation (albeit with gaps — see below).

> Note: "fully implemented" here means the unit is internally complete. Almost nothing is fully implemented *and* integrated across the full stack.

---

## 🟡 Partially Implemented Features

- **Authentication / JWT** — Login works, but PKCE `code_verifier` is never passed, `getOAuthClient` never calls `setCredentials`, and the JWT secret falls back to a hardcoded default.
- **File & Folder Management** — Real services (`services/files.ts`) exist but routes return placeholders; frontend queries a placeholder endpoint.
- **File Explorer (frontend)** — Renders, but data layer points at placeholder responses.
- **Upload system** — Partial: writes a non-existent `status` field, `arrayBuffer` vs multipart mismatch, fake Google file id, no reassembly/resume.
- **Storage engine / storage modes** — Mode selection UI partially present; engine has a single-placement bug and does not honor the three modes properly.
- **Create-share** — Service stub exists; no working runtime.
- **Search** — `searchFiles()` service is real but never wired to a route; `/search` is shadowed by `/:fileId`.
- **Security controls** — JWT auth, token encryption, and zod validation exist in partial/insecure form.
- **Settings UI** — Static shell only; no backend persistence.
- **Responsiveness** — Layout partially responsive; not verified across breakpoints.

---

## ❌ Missing Features

- **Trash** — No routes, no service, no schema support. Entirely missing.
- **Activity log** — No backend, no schema model. Entirely missing.
- **Analytics** — No backend, no data; recharts installed but unused.
- **Notifications** — No backend, no schema model; the bell icon is decorative.
- **Search API** — No route; filters and search UI missing.
- **Sharing runtime** — `shares.ts` is 100% placeholder (list, access, revoke all missing).
- **Connected Drives management API** — `routes/drives.ts` is 100% placeholder.
- **Profile / Storage / Security / Preferences settings backends** — None exist.
- **Dashboard** — No dashboard page/route in the frontend.
- **File preview** — No preview UI/streaming.
- **Rate limiting** — Stub only. **CSRF protection** — Absent.
- **Sync engine runtime** — References missing schema fields; workers never started.

---

## 🐞 Bugs Found

1. **Route shadowing** — `/search` and other static routes are shadowed by `/:fileId` / `/:id` dynamic routes registered earlier.
2. **Frontend double `/api/v1` prefix** — `upload.ts`, `download.ts`, and `hooks/useDriveHealth.ts` prepend `/api/v1` on top of the axios baseURL, producing `/api/v1/api/v1/...`.
3. **`getOAuthClient` never calls `setCredentials`** — every Google Drive operation runs unauthenticated.
4. **Upload writes non-existent `File.status` field** — schema has no such column.
5. **Upload body mismatch** — backend reads `arrayBuffer` while the client sends multipart form data.
6. **Fake Google file id** — upload stores a placeholder id instead of a real Drive id.
7. **Connect-drive contract mismatch** — `Settings.handleConnectDrive` POSTs `/auth/connect` expecting `authUrl` JSON, but the backend replies with a 302 redirect, so the client always hits the catch branch.
8. **Storage engine single-placement bug** — does not distribute chunks per selected storage mode.
9. **Sidebar rendered with no props / Header pushes `/files?q=` but FileList ignores `q`.**
10. **helmet used with Hono** — incompatible middleware; security headers not actually applied.
11. **PKCE `code_verifier` never forwarded** in the token exchange.

---

## ⚠ Critical Issues

1. **Disconnected service/route architecture** — the single biggest issue. Routes do not call the real services, so the API surface is mostly placeholder. This is systemic across files, folders, drives, shares, search.
2. **Broken Google Drive integration** — `getOAuthClient` never sets credentials; all Drive calls would fail unauthenticated. The core value proposition (multi-drive virtual filesystem) is non-functional.
3. **Hardcoded secrets** — JWT fallback secret `'default-secret'` and a hardcoded scrypt salt `'salt'`. Both are severe: forgeable tokens and weakened token encryption.
4. **Insecure token transport** — auth tokens passed via URL hash fragment.
5. **No effective security middleware** — rate limiting is a 3-line stub, helmet is incompatible with Hono (no headers applied), CSRF absent.
6. **Schema-vs-code mismatches** — code reads/writes fields (`File.status`, `Drive.sync_token`) and models (Activity, Session, Notification) that do not exist in `schema.prisma`. Runtime errors on those paths.
7. **Background workers never started** — sync/health jobs are defined but never launched, so no background processing occurs.

---

## 💡 Recommendations

1. **Unify the backend layers.** Delete placeholder route bodies and have routes call the real `services/*.ts`. Establish one canonical path per feature; remove dead placeholder code.
2. **Fix the OAuth core first.** Make `getOAuthClient` call `setCredentials` with stored (decrypted) tokens; forward the PKCE `code_verifier`; correct `redirect_uri`.
3. **Remove all hardcoded secrets.** Require `JWT_SECRET` and a per-record/random salt from env; fail fast at boot if missing.
4. **Reconcile schema and code.** Add missing models/fields (File.status, Drive.sync_token, Activity, Session, Notification) or remove the code referencing them; run a migration.
5. **Fix the frontend API layer.** Remove the double `/api/v1` prefix; align the connect-drive contract (return `authUrl` JSON or handle the 302); make FileList honor `q` and query real endpoints.
6. **Correct route registration order** so static routes (`/search`) are declared before dynamic (`/:id`) routes.
7. **Replace security stubs** with a real rate limiter, Hono-compatible security headers, and CSRF protection; stop passing tokens in URL fragments (use secure cookies or an exchange endpoint).
8. **Wire and start background workers**; verify BullMQ/Redis connectivity.
9. **Implement the missing modules** (Trash, Activity, Analytics, Notifications, Search API, Sharing runtime, Drives management) only after the core file/upload/download path works end-to-end.
10. **Add tests** for the critical paths (auth, upload, download, chunk placement) before layering more features.

---

## 🚀 Priority Order for Fixing Before Production

**P0 — Blockers (nothing works without these):**
1. Fix `getOAuthClient` credentials + PKCE + redirect_uri (unblocks all Drive ops).
2. Remove hardcoded JWT secret and scrypt salt; enforce env-provided secrets.
3. Unify route/service layers for File, Folder, Upload, Download so the core flow works end-to-end.
4. Reconcile schema-vs-code field/model mismatches and migrate.
5. Fix frontend double `/api/v1` prefix and connect-drive contract.

**P1 — Core correctness & security:**
6. Fix route shadowing (`/search` vs `/:id`).
7. Correct upload body handling (multipart), real Google file id, and `File.status` usage.
8. Fix storage-engine placement to honor storage modes.
9. Replace rate-limit stub, apply Hono-compatible security headers, add CSRF, stop URL-fragment token transport.
10. Start background workers; verify Redis/BullMQ.

**P2 — Complete missing features:**
11. Search API + filters + UI.
12. Sharing runtime (create/list/access/revoke).
13. Trash (soft-delete + restore + purge).
14. Connected Drives management API + Dashboard page + File preview.

**P3 — Nice-to-have / polish:**
15. Activity log, Analytics, Notifications.
16. Settings backends (Profile/Storage/Security/Preferences).
17. Accessibility, responsiveness verification, and automated tests across the stack.
