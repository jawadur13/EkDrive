# Audit — Upload & Download Systems

Scope: chunked upload (init/chunk/complete), chunk download, reassembly, resume, ZIP.

Files: `backend/src/routes/upload.ts`, `backend/src/routes/download.ts`, `frontend/src/services/upload.ts`, `frontend/src/services/download.ts`.

## Feature status

| Feature | Status | Notes |
|---|---|---|
| Upload init | 🟡 Partial | Backend `/init` real; frontend never calls it. |
| Chunk upload | 🟡 Partial | Real logic but body-format mismatch + auth + schema bugs. |
| Upload complete | 🟡 Partial | Writes non-existent `status` field → error. |
| Chunk download | 🟡 Partial | Real fetch + checksum verify, but unauthenticated Drive client. |
| File reassembly / merge | ❌ Missing | No server-side stitch endpoint. |
| ZIP / folder download | ❌ Missing | Not implemented. |
| Resumable upload/download | ❌ Missing | No resume/offset tracking. |
| Progress UI | 🟡 Partial | Frontend computes chunks but flow is broken. |

## Upload — `routes/upload.ts`

Real endpoints: `/init` (line 13), `/:fileId/chunk/:chunkIndex` (line 60), `/:fileId/complete` (line 137). Uses `storage-engine.assignChunksToDrives`, `chunking.createChunkRecords`/`computeChecksum`, `storage-mode.getStorageMode`.

🐞 **Non-existent `status` field.** Lines 128-131 & 146-149 do `prisma.file.update({ data: { status: 'ready' } })`. The `File` model has no `status` field → Prisma error on every completion.

🐞 **Body-format mismatch.** Backend reads the chunk via `c.req.arrayBuffer()` (line 79); frontend sends `multipart/form-data`. The bytes will not be parsed as expected.

🐞 **Fake Google file id.** `google_file_id` is stored as a constructed string `ekdrive-chunk:${fileId}:${chunkIndex}` (lines 99, 117); the real id from the Drive response (`fields: 'id'`, line 111) is discarded. Downloads can never locate the real Drive object.

⚠ **Unauthenticated Drive client.** `getOAuthClient(chunk.drive.user_id)` (line 96) never sets credentials → upload to Drive fails.

🐞 **Own PrismaClient instance** (line 9).

## Download — `routes/download.ts`

More complete: GET `/:fileId` (line 10) returns file + chunk metadata from DB; GET `/:fileId/chunk/:chunkIndex` (line 42) fetches chunk bytes via `alt: 'media'`, verifies the xxhash checksum (line 75), and streams via `c.body` (line 81).

⚠ **Unauthenticated Drive client** (line 65) — same root cause.

❌ **No reassembly endpoint** — the client must fetch and stitch chunks itself; no merge/stream-through-server path.

❌ **No ZIP folder download, no resume support.**

🐞 **Own PrismaClient instance** (line 6).

## Frontend — `services/upload.ts` / `download.ts`

🐞 **`initUpload` never calls `/upload/init`** (lines 3-15) — it only computes chunk boundaries locally.

🐞 **Double `/api/v1` prefix.** axios `baseURL` is already `/api/v1`, yet `uploadChunk` posts to `/api/v1/upload/...` (line 17-24) and `completeUpload` to `/api/v1/upload/.../complete` (line 27) → requests hit `/api/v1/api/v1/...`. Same bug in `download.ts`.

🐞 **No checksum computed client-side**, so server-side verification can't be corroborated end-to-end.

## Verdict
Upload/download has the most real backend code after auth, but a chain of blocking bugs (auth, schema `status`, fake Drive ids, body format, double-prefix) means **no file can currently be uploaded or downloaded successfully**. Reassembly, ZIP, and resume are entirely missing.
