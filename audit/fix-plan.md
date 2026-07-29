# EkDrive — Complete Fix Plan

> Generated from audit reports (00–09) vs current codebase analysis.
> All file paths relative to `D:\Projects\EkDrive`.

---

## Architecture Overview

The project aims to be a **multi-Google-Drive virtual filesystem** with chunked storage, sync, sharing, and a React dashboard. Below is the current state:

| Layer | What's real | What's placeholder/broken |
|-------|-------------|--------------------------|
| Prisma schema | User, Drive, File, Chunk, AuthToken, StorageMode, HealthCheck, SyncEntry, ShareLink models | Missing `File.status`, `Drive.sync_token`, `Drive.last_sync_time` fields; no `Session`, `Notification`, `Activity` models |
| Backend services | `files.ts`, `storage-engine.ts`, `chunking.ts`, `drives.ts`, `drive-health.ts`, `sync.ts`, `auth.ts`, `storage-mode.ts` — real implementations | Service-layer bugs (auth, Prisma where clauses, key mismatches) and **routes never call them** |
| Backend routes | `auth.ts` (/login, /callback, /me, /logout, /connect) — real; `upload.ts` (/init, /chunk, /complete) — real; `download.ts` (/:fileId, /:fileId/chunk/:chunkIndex) — real | `files.ts`, `drives.ts`, `shares.ts`, `sync.ts`, `health.ts`, `storage-mode.ts`, `preview.ts` — **100% placeholder stubs** |
| Frontend | React + Vite + Tailwind scaffold, auth flow, store, API client, pages | Broken data contracts, double `/api/v1` prefix, placeholder queries, missing handlers |
| Workers | BullMQ queues defined in `workers/queue.ts` | **Never started** — not invoked from `index.ts` |
| WebSocket | Manager class in `ws/manager.ts` | **Commented out** in `index.ts`, mock implementation |

---

## Critical Blockers (P0)

### 1. `getOAuthClient` never calls `setCredentials`
- **Files:** `utils/drive-auth.ts:35`, `services/files.ts:157`, `routes/upload.ts:96`, `routes/download.ts:65`, `services/drive-health.ts:23`, `services/sync.ts:31`
- **Issue:** `getOAuthClient()` creates a `new OAuth2Client(...)` but never calls `.setCredentials(decryptedTokens)`. Every Google Drive API call runs unauthenticated and fails with 401.
- **Fix:** `getOAuthClient` must accept tokens and call `oauth2Client.setCredentials({ access_token, refresh_token })`, OR callers must set credentials after getting the client.

### 2. Hardcoded JWT fallback secret
- **Files:** `middleware/auth.ts:30`, `routes/auth.ts:96,102`
- **Issue:** `process.env.JWT_SECRET || 'default-secret'` — if env var is unset, tokens are forgeable by anyone.
- **Fix:** Remove fallback; throw at boot if `JWT_SECRET` is missing. Same for `ENCRYPTION_KEY`.

### 3. Hardcoded scrypt salt (`'salt'`)
- **Files:** `utils/drive-auth.ts:15`, `services/files.ts:142`, `utils/crypto.ts:8`, `services/auth.ts:11,24`
- **Issue:** Static salt `'salt'` is used across all files for key derivation, weakening token-at-rest encryption.
- **Fix:** Use a random per-install salt from env (`ENCRYPTION_SALT`), or use a per-record salt stored alongside the ciphertext.

### 4. Routes never call real services (disconnected layers)
- **Files:** `routes/files.ts` (entire file), `routes/drives.ts` (entire file), `routes/shares.ts` (entire file), `routes/sync.ts` (entire file), `routes/health.ts` (entire file), `routes/storage-mode.ts` (entire file)
- **Issue:** Every route handler returns hardcoded/placeholder JSON instead of calling the corresponding `services/*.ts` functions. The API surface is non-functional end-to-end.
- **Fix:** Rewire each route to call its service counterpart. Remove placeholder stubs.

### 5. Schema-vs-code mismatches
- **Multiple locations:**
  - `routes/upload.ts:128-131,146-149` — writes `File.status = 'ready'` but schema has no `status` field → Prisma error
  - `services/sync.ts:13-14` — reads `drive.last_sync_time` and `drive.sync_token` but schema has no such columns → runtime error
  - `routes/auth.ts:68-69` — writes `displayName`/`avatarUrl` (camelCase) but schema has `display_name`/`avatar_url` (snake_case)
- **Fix:** Either add missing fields to schema (run migration) or fix code to use existing fields.

### 6. Frontend double `/api/v1` prefix
- **Files:** `frontend/src/services/api.ts` (baseURL: `/api/v1`), `frontend/src/services/upload.ts:17,27`, `frontend/src/services/download.ts:5,9,13`, `frontend/src/hooks/useDriveHealth.ts:10,14`
- **Issue:** API client already sets `/api/v1` base, but individual service files prepend `/api/v1` again → requests hit `/api/v1/api/v1/...` returning 404.
- **Fix:** Remove the duplicate `/api/v1` prefix from all service files and hooks.

### 7. PKCE `code_verifier` never forwarded to token exchange
- **File:** `routes/auth.ts:41`
- **Issue:** `codeVerifier` is generated (line 8) and `code_challenge` is sent in the auth URL (line 17), but `client.getToken(code)` is called without the `code_verifier` parameter. If Google enforces PKCE, the exchange fails.
- **Fix:** Store `codeVerifier` (e.g., in session/state), retrieve it in `/callback`, and pass it: `client.getToken({ code, codeVerifier })`.

### 8. Upload writes non-existent `File.status` field
- **File:** `routes/upload.ts:128-131,146-149`
- **Issue:** `prisma.file.update({ data: { status: 'ready' } })` — the `File` model has no `status` column. This causes a Prisma validation error.
- **Fix:** Remove the `status` writes, or add `status` to the Prisma schema and run a migration.

---

## Core Correctness Bugs (P1)

### 9. Upload body-format mismatch (arrayBuffer vs multipart)
- **Files:** `routes/upload.ts:79` (reads `c.req.arrayBuffer()`), frontend `upload.ts:17` (sends `multipart/form-data`)
- **Issue:** Backend expects raw bytes via `arrayBuffer()` but frontend sends `FormData`. The chunk bytes will not be parsed correctly.
- **Fix:** Align on one format — either `multipart/form-data` on both sides or raw binary.

### 10. Fake Google file id stored in chunk records
- **File:** `routes/upload.ts:99,117`
- **Issue:** After uploading a chunk to Google Drive, the API returns the real file id in the response (`fields: 'id'`), but the code stores a constructed string `ekdrive-chunk:${fileId}:${chunkIndex}` instead. Downloads can never locate the real Drive object.
- **Fix:** Store the actual `response.data.id` from the Drive API response (line 111 returns it, but it's discarded).

### 11. Storage engine single-placement bug
- **File:** `services/storage-engine.ts:72,80`
- **Issue:** In `max_capacity` and `balanced` modes, `assignChunksToDrives` only creates one placement entry (chunk index `0`) even for multi-chunk files. Only the first chunk is placed; remaining chunks are orphaned.
- **Fix:** For multi-chunk files in `max_capacity`/`balanced` modes, iterate over chunk count and assign each chunk to a drive (similar to `high_reliability` at lines 88-93).

### 12. Route shadowing — `/search` unreachable
- **File:** `routes/files.ts:52-54`
- **Issue:** `/search` route is declared after `/:fileId` (line 18). Hono matches `/:fileId` first, so `GET /files/search` resolves with `fileId = "search"`. The search route is never reachable.
- **Fix:** Move static routes before dynamic `/:id` routes, or use a separate prefix for search (e.g., `/search/files?q=...`).

### 13. Connect-drive contract mismatch (frontend vs backend)
- **Files:** `frontend/src/pages/Settings.tsx:10-15`, `routes/auth.ts:113-129`
- **Issue:** Frontend calls `/auth/connect` expecting `response.data.authUrl` (JSON), but backend returns a 302 redirect. The catch branch falls through and navigates to `/api/v1/auth/login`, which also redirects — but the frontend never gets a URL to open in a new window.
- **Fix:** Backend should return `{ authUrl: string }` JSON instead of redirecting, OR frontend should handle the redirect directly with `window.location.href`.

### 14. Invalid Prisma `where` in update/delete operations
- **Files:** `services/files.ts:86`, `services/drives.ts:22`
- **Issue:** `prisma.file.update({ where: { id: fileId, user_id: userId } })` — Prisma `update` only accepts unique fields; `user_id` is not part of the unique constraint. This throws a runtime error.
- **Fix:** Use `findFirst` for the ownership check first, then update with `where: { id: fileId }`.

### 15. `drive_assignments` key inconsistency
- **File:** `services/files.ts:59,77,94`
- **Issue:** `createFolder`/`uploadFile` store `{ '0': driveId }` keyed by chunk index, but `deleteFile` reads `file.drive_assignments?.[googleFileId]` keyed by Google file id. Deletion never locates the drive, so remote chunks are orphaned.
- **Fix:** Standardize the key format in `drive_assignments` (use chunk index consistently when applicable, or Google file id consistently).

### 16. Frontend `FileList` ignores `folderId` and `q` params
- **File:** `frontend/src/pages/FileList.tsx`
- **Issue:** The `folderId` state is set to `null` and never updated from route params or navigation. The `q` query param from Header search is also never read. The query key `['files', folderId]` never changes, so navigation into folders and search don't work.
- **Fix:** Read `folderId` from `useParams()` and `q` from `useSearchParams()`. Pass them to the API query.

### 17. Frontend queries placeholder `/files` endpoint
- **File:** `frontend/src/pages/FileList.tsx:21`
- **Issue:** `api.get('/files')` hits the placeholder route that returns `{ files: [], pagination }`. No real file data is ever displayed.
- **Fix:** After P0#4 (rewiring routes to services), this will automatically resolve when the backend returns real data.

### 18. Sidebar rendered without required props
- **File:** `frontend/src/App.tsx:35`
- **Issue:** `<Sidebar />` is rendered with no props, but the component declares `isCollapsed: boolean` and `onToggle: () => void` as required. Causes TypeScript error / runtime `undefined` behavior.
- **Fix:** Pass `isCollapsed` and `onToggle` props to `<Sidebar />`.

---

## Missing Features (P2)

### 19. File Management routes — wire to services
- **Routes:** `routes/files.ts` GET `/` → `services/files.ts:listFiles`; GET `/:fileId` → `getFileById`; POST `/` → `createFolder`/`uploadFile`; PATCH `/:fileId` → `updateFile`; DELETE `/:fileId` → `deleteFile`
- **Current:** All placeholder. Need to call real services and handle errors.

### 20. Connected Drives API — wire to services
- **Routes:** `routes/drives.ts` GET `/` → `services/drives.ts:getDrivesByUser`; POST `/` → `createDrive`; GET `/:driveId` → `getDriveById`; DELETE `/:driveId` → `deleteDrive`; GET `/:driveId/health` → `services/drive-health.ts:checkDriveHealth`
- **Current:** All placeholder. Need to wire to services and fix the invalid `where` clause (see P1#14).

### 21. Storage Mode API — wire to services
- **Routes:** `routes/storage-mode.ts` GET `/` → `services/storage-mode.ts:getStorageMode`; PUT `/` → `updateStorageMode`; GET `/rebalance` → real rebalance logic
- **Current:** Static responses. Need real implementation.

### 22. Sharing runtime — implement all operations
- **Routes:** `routes/shares.ts` POST `/` → create `ShareLink` in DB; GET `/` → list shares; GET `/:token` → look up share, authorize access; DELETE `/:shareId` → revoke
- **Current:** All placeholder. `ShareLink` model exists but is never read/written.

### 23. Search API — wire and fix routing
- **Service:** `services/files.ts:searchFiles` — real implementation exists
- **Route:** Move `/search` before `/:fileId` or use separate prefix (e.g., `/search/files`)
- **Frontend:** `Header.tsx` search → actually call search API → display results
- **Current:** Service exists but unreachable due to route shadowing; UI navigates to `/files?q=` but `FileList` ignores `q`.

### 24. Trash — implement soft delete
- **Schema:** No `deleted_at` / `is_trashed` field on `File`
- **Routes:** Need ADD: `GET /trash`, `POST /trash/:fileId/restore`, `DELETE /trash/:fileId/purge`
- **Services:** Need new or extended `services/trash.ts`
- **Current:** Entirely missing.

### 25. Dashboard page — implement
- **Frontend:** No dashboard route or page. App lands on `/files`.
- **Need:** Create `Dashboard.tsx` page with overview stats (total files, storage used, drive health, recent activity).
- **Current:** Entirely missing.

### 26. File preview / streaming — implement
- **Routes:** `routes/preview.ts` — metadata endpoint is real; `/stream` and `/thumbnail` return JSON instead of actual bytes.
- **Need:** Implement byte-range streaming from chunks; implement thumbnail generation.
- **Frontend:** Need a preview modal/component.

### 27. Sync workers — start them
- **File:** `workers/queue.ts` defines `startHealthWorker`, `startSyncWorker`, `startCleanupWorker`
- **Issue:** These are never invoked from `index.ts`. No background sync or health monitoring runs.
- **Fix:** Call these functions in `index.ts` after server starts.

---

## Security & Production Hardening (P2)

### 28. Insecure token transport via URL hash
- **File:** `routes/auth.ts:107`
- **Issue:** JWT is delivered via `#access_token=...&refresh_token=...` in the redirect URL. Tokens leak into browser history and are readable by any script on the page.
- **Fix:** Use HttpOnly cookie (set by backend via `Set-Cookie` header) or a one-time code exchange.

### 29. Rate limiting is a 3-line stub
- **File:** `middleware/rate-limit.ts`
- **Issue:** The middleware exports an empty `Hono` instance. No actual rate limiting logic exists. Auth and upload endpoints are unthrottled.
- **Fix:** Implement a real rate limiter (e.g., `@hono/rate-limiter` or an in-memory/Redis-based solution).

### 30. `helmet` is Express middleware, incompatible with Hono
- **File:** `index.ts:21`
- **Issue:** `app.use('*', helmet())` — `helmet` is designed for Express and does not function as Hono middleware. Security headers (CSP, HSTS, X-Frame-Options) are not applied.
- **Fix:** Use `hono/secure-headers` or `@hono/helmet` (Hono-compatible), or manually set security headers.

### 31. CSRF protection absent
- **Issue:** No CSRF token mechanism exists. Cookie-based JWT flow is vulnerable to CSRF attacks.
- **Fix:** Implement CSRF tokens or use `SameSite=Strict` cookies + header-based token pattern.

### 32. `redirect_uri` points to frontend, not backend
- **File:** `routes/auth.ts:13,38,120`
- **Issue:** `redirect_uri` is set to `${CORS_ORIGIN}/auth/callback` (the frontend URL), but the backend `/callback` handler is what processes the code. Google sends the code to the frontend URL, not the backend endpoint.
- **Fix:** Set `redirect_uri` to the backend callback URL (e.g., `/api/v1/auth/callback`), and have the backend handle the exchange directly.

### 33. Empty refresh token persisted
- **File:** `routes/auth.ts:81,87`
- **Issue:** When Google omits `refresh_token` (common on re-auth), the code stores `''` (empty string). Later, `refreshAccessToken` will try to decrypt an empty string and fail.
- **Fix:** Store `null` instead of `''`, and skip refresh when `refresh_token` is null/empty.

### 34. Own `PrismaClient` instances in multiple files
- **Files:** `services/files.ts:4`, `services/sync.ts:5`, `services/drive-health.ts:5`, `services/auth.ts:4`, `middleware/auth.ts:4`, `routes/upload.ts:9`, `routes/download.ts:6`, `utils/drive-auth.ts:5`, `workers/queue.ts:7`
- **Issue:** Each file creates its own `new PrismaClient()` instead of using the shared singleton from `db/client.ts`. Causes connection-pool bloat.
- **Fix:** Import `prisma` from `../db/client` in all these files.

### 35. `require()` inside ESM modules
- **Files:** `services/files.ts:158`, `utils/crypto.ts:17`
- **Issue:** `require('google-auth-library')` / `require('crypto')` used in ESM (`"type": "module"` in package.json). This will throw `ReferenceError: require is not defined`.
- **Fix:** Use `import` instead of `require`.

### 36. Token transport — `getOAuthClient` in `services/files.ts` reimplements decrypt
- **File:** `services/files.ts:129-155,157-164`
- **Issue:** Duplicates the `decrypt` function and `getOAuthClient` from `utils/drive-auth.ts` with same bugs (hardcoded salt, missing `setCredentials`).
- **Fix:** Import from `utils/drive-auth.ts` instead of duplicating. Remove the inline versions.

---

## Nice-to-Have / Polish (P3)

### 37. Settings — implement Profile, Storage, Security, Preferences
- **Backend:** No settings/profile route exists. Need `PATCH /auth/me` for profile updates.
- **Frontend:** `Settings.tsx` is a static shell. Need actual forms, wire to backend, and multiple tabs/pages.
- **Services:** `services/user.ts` exists but is minimal.

### 38. Activity log — implement
- **Schema:** No `Activity` model. Need to create one.
- **Backend:** Need routes/services to log and query file operations (upload, download, delete, share, etc.).
- **Frontend:** Need activity feed page/component.
- **Current:** Entirely missing.

### 39. Analytics — implement
- **Backend:** No analytics aggregation endpoints. Need storage usage over time, file type distribution, drive utilization charts.
- **Frontend:** `recharts` is installed but unused. Need dashboard charts.
- **Current:** Entirely missing.

### 40. Notifications — implement
- **Schema:** No `Notification` model.
- **Backend:** Need notification service + WebSocket push (WS manager exists but is commented out and mock).
- **Frontend:** Notification bell in `Header.tsx` has no handler. Need dropdown with list, unread count.
- **Current:** Entirely missing.

### 41. WebSocket manager — fix and uncomment
- **File:** `ws/manager.ts`, `index.ts:43-44`
- **Issue:** The WS manager uses `new WebSocket('ws://placeholder')` as a mock — this is non-functional. Also commented out in `index.ts`.
- **Fix:** Real implementation with `hono/ws` + proper connection handling.

### 42. Accessibility (A11y)
- **Issue:** No aria labels, focus management, keyboard navigation, or semantic landmarks verified.
- **Fix:** Audit with axe DevTools, add aria attributes, focus traps in dialogs, keyboard event handlers.

### 43. Error handling — inconsistent
- **Issue:** Some services `throw new Error()` with no route-level `try/catch`, risking unhandled 500s and stack leakage.
- **Fix:** Add consistent error middleware in Hono; wrap service calls in routes.

### 44. Zod validation — inconsistent
- **Issue:** Zod is installed but only used in `routes/files.ts` POST handler and `middleware/validation.ts`.
- **Fix:** Apply validation middleware to all routes that accept input.

---

## Priority Implementation Order

```
Phase 1 — Fix Blocking Bugs (P0, ~2 days)
├── 1. getOAuthClient setCredentials  (utils/drive-auth.ts)
├── 2. Remove hardcoded secrets        (middleware/auth.ts, utils/crypto.ts)
├── 3. Fix redirect_uri mismatch       (routes/auth.ts)
├── 4. PKCE code_verifier forwarding   (routes/auth.ts)
├── 5. Fix schema-vs-code mismatches   (routes/upload.ts, routes/auth.ts, services/sync.ts)
├── 6. Fix upload body + file id bugs  (routes/upload.ts)
├── 7. Remove double /api/v1 prefix    (frontend services + hooks)
└── 8. Fix Frontend component Bugs     (FileList, Sidebar, Settings)

Phase 2 — Wire Real Services (P1, ~3 days)
├── 9.  Rewire routes/files.ts    → services/files.ts
├── 10. Rewire routes/drives.ts   → services/drives.ts + fix Prisma where
├── 11. Rewire routes/shares.ts   → create/list/access/revoke with ShareLink model
├── 12. Rewire routes/sync.ts     → services/sync.ts + add missing schema fields
├── 13. Rewire routes/health.ts   → services/drive-health.ts
├── 14. Rewire routes/storage-mode.ts → services/storage-mode.ts
├── 15. Fix route shadowing       (routes/files.ts)
├── 16. Fix storage-engine single-placement (services/storage-engine.ts)
└── 17. Fix connect-drive contract (routes/auth.ts + frontend Settings.tsx)

Phase 3 — Security & Infrastructure (P2, ~2 days)
├── 18. Replace helmet with Hono-compatible secure-headers
├── 19. Implement real rate limiter
├── 20. Add CSRF protection
├── 21. Fix token transport (HttpOnly cookie vs URL hash)
├── 22. Consolidate PrismaClient instances → shared singleton
├── 23. Replace require() → import in ESM files
├── 24. Start background workers (health, sync, cleanup)
└── 25. Fix WS manager or remove dead code

Phase 4 — Missing Features (P3, ~5 days)
├── 26. Search API + Filters + UI
├── 27. Trash (soft delete + restore + purge)
├── 28. Dashboard page
├── 29. File preview / streaming
├── 30. Settings backends (profile, storage, security, preferences)
├── 31. Activity log
├── 32. Analytics
├── 33. Notifications
├── 34. A11y audit + fixes
└── 35. Tests for critical paths
```

---

## Key File Reference

| File | Primary Issues |
|------|---------------|
| `backend/src/utils/drive-auth.ts` | P0#1, P0#3 |
| `backend/src/utils/crypto.ts` | P0#3, P3#35 |
| `backend/src/middleware/auth.ts` | P0#2, P0#5, P2#34 |
| `backend/src/middleware/rate-limit.ts` | P2#29 |
| `backend/src/routes/auth.ts` | P0#2, P0#5, P0#7, P2#28, P2#32, P2#33 |
| `backend/src/routes/files.ts` | P0#4, P1#12 |
| `backend/src/routes/upload.ts` | P0#5, P0#8, P1#9, P1#10, P2#34 |
| `backend/src/routes/download.ts` | P1#10, P2#34 |
| `backend/src/routes/drives.ts` | P0#4 |
| `backend/src/routes/shares.ts` | P0#4 |
| `backend/src/routes/sync.ts` | P0#4 |
| `backend/src/routes/health.ts` | P0#4 |
| `backend/src/routes/storage-mode.ts` | P0#4 |
| `backend/src/routes/preview.ts` | P2#26 |
| `backend/src/services/files.ts` | P1#14, P1#15, P2#34, P2#35, P2#36 |
| `backend/src/services/storage-engine.ts` | P1#11 |
| `backend/src/services/drives.ts` | P1#14 |
| `backend/src/services/sync.ts` | P0#5, P2#34 |
| `backend/src/services/drive-health.ts` | P2#34 |
| `backend/src/services/auth.ts` | P0#3, P2#34 |
| `backend/src/index.ts` | P2#30, P2#41, P0#1 |
| `backend/src/workers/queue.ts` | P1#27, P2#34 |
| `backend/src/ws/manager.ts` | P3#41 |
| `backend/src/db/client.ts` | Shared singleton reference |
| `backend/prisma/schema.prisma` | P0#5 — missing fields/models |
| `frontend/src/services/api.ts` | P0#6 |
| `frontend/src/services/upload.ts` | P0#6, P1#9 |
| `frontend/src/services/download.ts` | P0#6 |
| `frontend/src/hooks/useDriveHealth.ts` | P0#6 |
| `frontend/src/pages/FileList.tsx` | P1#16, P1#17 |
| `frontend/src/pages/Settings.tsx` | P1#13 |
| `frontend/src/components/Sidebar.tsx` | P1#18 |
| `frontend/src/App.tsx` | P1#18 |
