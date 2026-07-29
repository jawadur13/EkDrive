# Audit — Storage, Connected Drives, Storage Modes, Chunking Engine

Scope: virtual filesystem over multiple Drives, drive connect/list/health, storage modes, chunk sizing/checksums.

Files: `backend/src/routes/drives.ts`, `backend/src/routes/storage-mode.ts`, `backend/src/services/storage-engine.ts`, `backend/src/services/drives.ts`, `backend/src/services/chunking.ts`, `backend/src/services/storage-mode.ts`.

## Feature status

| Feature | Status | Notes |
|---|---|---|
| Connect Google Drive | ❌ Broken | Route is placeholder; not wired to service. |
| List connected drives | ❌ Broken | Route returns `{ drives: [] }`. |
| Get drive / delete drive | 🟡 Partial | Service exists but invalid Prisma where; route is placeholder. |
| Drive quota / capacity | 🟡 Partial | Storage-engine reads quota but path is unauthenticated. |
| Storage mode select (3 modes) | 🟡 Partial | Service real; route returns static config. |
| Rebalance | ❌ Missing | Route returns static message only. |
| Chunk sizing | ✅ Implemented | `chunking.ts` logic reasonable. |
| Checksums (xxhash) | ✅ Implemented | `computeChecksum` real and used in download verify. |
| Replica placement | 🟡 Partial | `high_reliability` places replicas; other modes place only one. |

## Connected Drives — `routes/drives.ts`

⚠ **100% placeholder stubs** (26 lines). None wired to `services/drives.ts` or `services/drive-health.ts`:
- GET `/` → `{ drives: [] }`
- POST `/` → `{ id: 'placeholder-uuid', message: 'Drive connected' }`
- GET `/:driveId` → `{ id, name: 'placeholder' }`
- DELETE → static message
- GET `/:driveId/health` → `{ status: 'healthy', latencyMs: 0, quotaAvailable: 0 }`

Result: **the Connected Drives module is non-functional at the API layer.**

## Storage engine — `services/storage-engine.ts`

Real drive-selection algorithms exist.

🐞 **Single-placement bug.** `assignChunksToDrives` only creates one placement (chunk index `0`) for `max_capacity`/`balanced` modes even for large multi-chunk files, so files bigger than one chunk are not fully distributed.

## Drives service — `services/drives.ts`

🐞 `deleteDrive` / update use `where: { id, user_id }` — invalid Prisma unique where → runtime error.

## Storage modes — `routes/storage-mode.ts`

🟡 Placeholder: GET `/` returns static `{ mode: 'balanced', minReplicas: 1, rebalanceThreshold: 0.2 }`; PUT echoes body; `/rebalance` static. Real `services/storage-mode.ts` exists but unused.

## Chunking — `services/chunking.ts`

✅ Reasonable: chunk-size selection, `createChunkRecords`, `computeChecksum` via xxhash-wasm. This is one of the healthier modules, though it depends on the broken upload path to be exercised.

## Verdict
Chunking is solid; the storage engine is a good draft with a real replica-placement gap. Connected Drives and Storage Modes are **placeholder-only at the API layer** — users cannot connect or manage drives.
