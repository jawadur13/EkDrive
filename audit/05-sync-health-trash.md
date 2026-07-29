# Audit — Synchronization, Drive Health, Trash

Scope: bidirectional sync + conflict resolution, drive health monitoring, trash/soft-delete.

Files: `backend/src/routes/sync.ts`, `backend/src/routes/health.ts`, `backend/src/services/sync.ts`, `backend/src/services/drive-health.ts`, `backend/prisma/schema.prisma`.

## Feature status

| Feature | Status | Notes |
|---|---|---|
| Sync status | ❌ Broken | Route static; service references missing schema fields. |
| Trigger sync | ❌ Broken | Route static; no worker running. |
| Conflict detection / resolution | ❌ Missing | Route returns static; no real logic wired. |
| Drive health check | 🟡 Partial | Service real but uses unauthenticated client. |
| Health monitoring / scheduling | ❌ Missing | Workers never started. |
| Trash / soft delete | ❌ Missing | No schema field, no model, no route. |
| Restore from trash | ❌ Missing | Not implemented. |
| Auto-purge trash | ❌ Missing | Not implemented. |

## Synchronization

🟡 `routes/sync.ts` (20 lines): `/status`, `/trigger`, `/conflicts`, `/conflicts/:conflictId/resolve` all return static JSON.

🐞 `services/sync.ts` references `drive.last_sync_time` and `drive.sync_token`, **neither of which exists** in the `Drive` model (only `last_health_check`). Any real sync call throws.

⚠ No background scheduler runs — `workers/queue.ts` defines BullMQ queues but **workers are never started** (not invoked from `index.ts`).

## Drive Health

🟡 `routes/health.ts` (10 lines): GET `/` → `{ status: 'ok' }`; GET `/drives` → `{ drives: [] }`.

`services/drive-health.ts` has real latency/quota probing logic, but:

⚠ Uses the buggy `getOAuthClient` (no `.setCredentials()`) → health probes are unauthenticated and will fail.

❌ No scheduled/periodic health checks (worker not started).

## Trash

❌ **Entirely missing.** The schema has no `deleted_at` / `is_trashed` field and no Trash model. `deleteFile` in `services/files.ts` attempts a hard delete (which itself is broken by the `drive_assignments` key mismatch). There is no route, no restore, and no auto-purge.

## Schema gaps (root cause for this module)

- `Drive` missing `sync_token`, `last_sync_time`.
- No soft-delete field on `File`.
- No `SyncEntry` conflict-state modeling beyond the base model.

## Verdict
Sync, health scheduling, and trash are **missing or broken**. Drive-health has real probing code but is blocked by the auth bug and has no scheduler. Schema changes are prerequisites here.
