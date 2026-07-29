# Audit — File & Folder Management, File Explorer, Preview

Scope: list/get/create/update/delete files & folders, folder navigation, search, preview.

Files: `backend/src/routes/files.ts`, `backend/src/services/files.ts`, `backend/src/routes/preview.ts`, `frontend/src/pages/FileList.tsx`, `frontend/src/components/*`.

## Feature status

| Feature | Status | Notes |
|---|---|---|
| List files/folders | 🟡 Partial | Real service `listFiles` exists but route returns hardcoded empty array. |
| Get file by id | 🟡 Partial | Real service exists; route returns `{ name: 'placeholder' }`. |
| Create folder | 🟡 Partial | Real `createFolder` service exists; route returns placeholder uuid. |
| Rename / move / update | 🟡 Partial | Service `updateFile` exists but uses invalid Prisma where clause. |
| Delete file | 🟡 Partial | Service exists but delete never finds the drive (key mismatch). |
| Search | ❌ Broken | Route defined after `/:fileId` so it is shadowed; never reachable. |
| File preview metadata | ✅ Implemented | `preview.ts` computes `previewable` from mime type. |
| Preview streaming | ❌ Missing | `/stream` returns JSON message, not bytes. |
| Thumbnails | ❌ Missing | `/thumbnail` returns `{ thumbnail_url: null }`. |
| File explorer UI | 🟡 Partial | Renders but queries the placeholder endpoint; folder nav broken. |

## Central architectural problem

⚠ **Two parallel, disconnected layers.** `services/files.ts` contains real implementations (cursor pagination, count, create/update/delete, search), but `routes/files.ts` handlers **never call them** — every route returns a hardcoded placeholder:
- GET `/` → `{ files: [], pagination }` (line 14)
- GET `/:fileId` → `{ id, name: 'placeholder' }` (line 18)
- POST `/` → `{ id: 'placeholder-uuid', ...parsed.data }` (line 23)
- PATCH/DELETE → static messages (lines 32, 37)
- `/:fileId/download`, `/:fileId/preview` → stub JSON (lines 42, 47)

Net effect: **file management is non-functional end-to-end** despite the service code existing.

## Bugs in `services/files.ts` (would surface once wired)

🐞 **Invalid Prisma where.** `updateFile` (line 86) uses `where: { id: fileId, user_id: userId }` — Prisma `update` only accepts unique fields. Runtime error.

🐞 **`drive_assignments` key inconsistency.** `createFolder`/`uploadFile` write `{ '0': driveId }` keyed by chunk index (lines 59, 77), but `deleteFile` reads `file.drive_assignments?.[googleFileId]` keyed by Google file id (line 94). **Deletion never locates the drive**, so remote chunks are orphaned.

🐞 **Own PrismaClient instance** (line 4) instead of the `db/client` singleton — connection-pool bloat.

⚠ **Unauthenticated Drive client.** Local `getOAuthClient` (lines 157-163) creates `new OAuth2Client(...)` and never calls `.setCredentials()` → all Drive calls unauthenticated.

🐞 **Hardcoded salt** `scryptSync(ENCRYPTION_KEY, 'salt', 32)` (line 142).

🐞 **`require()` inside ESM** (line 158) — `require('google-auth-library')` in an ES module.

## Route shadowing

🐞 In `routes/files.ts`, `/search` (line 52) is declared **after** `/:fileId` (line 18). Hono matches `/:fileId` first, so `/files/search` is treated as `fileId="search"`. Search is unreachable via this router.

## Frontend

🐞 `FileList.tsx` queries the placeholder `/files` endpoint (always empty). `folderId` never changes on navigation. Upload button has no handler. Uses `file.drive_name`, which the backend never returns.

## Verdict
Core file/folder CRUD is **effectively missing in practice**. The service layer is a good foundation but is not connected, and it carries several correctness bugs that must be fixed before wiring.
