# EkDrive

EkDrive joins several Google Drive accounts into one storage pool. You work with a single virtual drive; EkDrive splits files into chunks, places them across the connected accounts according to the storage mode, and puts them back together on download.

## Status

Working prototype — feature-complete for the flows below, not yet hardened for production. See [Known limitations](#known-limitations).

| Area | State |
|---|---|
| Google sign-in, connecting several accounts as drives | Working |
| Chunked upload, download, range streaming | Working |
| Folders, search, share links, trash | Working |
| Storage modes, rebalancing, self-repair | Working |
| Drive health, change sync | Working |
| Activity log, notifications, analytics dashboard | Working |

## How it works

- **Accounts as drives.** The Google account you sign in with becomes your first drive; Settings → Connect Drive adds more. Each drive keeps its own OAuth tokens, encrypted with AES-256-GCM, and refreshes them on its own.
- **Chunks.** Files are split into `CHUNK_SIZE_BYTES` chunks (50 MB by default) and stored in an `EkDrive` folder on each account. The browser computes an xxhash64 checksum per chunk; the server verifies it on upload and again on every download.
- **Storage modes** — applied to new uploads, and to existing files when you rebalance:
  - *Balanced*: each chunk goes to the drive that stays least utilized.
  - *Maximum capacity*: each chunk goes to the drive with the most free space.
  - *High reliability*: each chunk is stored on at least two drives. Downloads fall back to another copy when one is missing or corrupt.
- **Folders** are virtual — they exist only in EkDrive's database, so moving and renaming never touches Google Drive.
- **Trash.** Deleting moves an item to the trash for 30 days. Trashed files keep using Google space until they are purged.
- **Self-repair.** When a chunk is deleted outside EkDrive, sync marks that copy missing, rebuilds it from another copy and notifies you. A file with no copy left is reported as damaged. `POST /api/v1/files/:id/repair` runs a repair on demand.
- **Background jobs** (need Redis): drive health every 15 minutes, change sync every 10 minutes, and a daily cleanup of abandoned uploads, expired trash, expired share links and old health records.

## Development setup

Requirements: Node 22+, pnpm 10, a PostgreSQL database, and a Google Cloud OAuth client (web application). Redis is optional.

```bash
pnpm install
cp .env.example .env.local        # fill in the values
pnpm db:migrate                   # applies prisma/migrations to DATABASE_URL
pnpm dev                          # backend :3000, frontend :5173
```

In Google Cloud Console: enable the Google Drive API, add `http://localhost:5173` as an authorized JavaScript origin, and add `<BACKEND_URL>/api/v1/auth/callback` as an authorized redirect URI. EkDrive requests only the `drive.file` scope, so it can see only the files it created.

If port 3000 is taken, set `PORT` and `BACKEND_URL` in `.env.local` (for example 3100). The Vite dev proxy reads `BACKEND_URL` from there, so nothing else changes — but the redirect URI in Google Cloud Console has to match the new `BACKEND_URL`.

## Configuration

Every variable lives in `.env.local` at the repo root; `.env.example` documents each one.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `JWT_SECRET`, `ENCRYPTION_KEY`, `ENCRYPTION_SALT` | yes | The backend refuses to start without them |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | yes | OAuth client for a web application |
| `REDIS_URL` | no | A `redis://` or `rediss://` TCP URL. Without it, background jobs stay off |
| `BACKEND_URL`, `CORS_ORIGIN`, `PORT` | no | Defaults are localhost 3000 / 5173 |
| `CHUNK_SIZE_BYTES` | no | 50 MB by default |
| `RATE_LIMIT_MAX`, `TRUST_PROXY` | no | `TRUST_PROXY=true` only behind a proxy you control |

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Backend (tsx watch) and frontend (Vite) together |
| `pnpm build` | Type-checks, bundles the backend to `backend/dist`, builds the frontend to `frontend/dist` |
| `pnpm test` | Unit tests in both packages |
| `pnpm --filter ekdrive-backend test:integration` | API tests against the real `DATABASE_URL` |
| `pnpm lint` / `pnpm typecheck` | ESLint / `tsc --noEmit` in both packages |
| `pnpm db:migrate` | `prisma migrate deploy` using `.env.local` |
| `pnpm --filter ekdrive-backend start` | Runs the built backend |

## Testing

- **Unit tests** cover chunk placement for each storage mode, encryption round-trips, checksums, path handling and header building. They need no database.
- **Integration tests** drive the real HTTP app against the database in `DATABASE_URL`, with only Google Drive replaced by an in-memory store. They cover the upload → download path, replicas and fallback, trash, range requests, repair, rebalance, share links, ownership isolation, activity, notifications and analytics. They create their own users and delete everything afterwards, but they do write to that database — point `DATABASE_URL` at a development one.

## API

All routes are under `/api/v1` and need the session cookie, except `/auth/login`, `/auth/callback` and `/shares/public/*`.

| Group | Routes |
|---|---|
| `auth` | `login`, `callback`, `connect`, `me`, `logout` |
| `files` | list, search, breadcrumbs, create folder, rename/move, trash, `:id/download`, `:id/preview`, `:id/repair` |
| `upload` | `init`, `:id/chunk/:index`, `:id/complete`, abort |
| `trash` | list, restore, delete one, empty |
| `drives` | list, get, disconnect, health check |
| `storage-mode` | get, set, rebalance |
| `shares` | create, list, revoke, `public/:token`, `public/:token/content` |
| `sync` | status, trigger, conflicts, resolve |
| `activity`, `notifications`, `analytics` | activity feed, notification list/read, dashboard figures |

## Project layout

```
backend/
  prisma/           schema and migrations
  src/routes/       HTTP layer (Hono)
  src/services/     storage engine, chunking, files, sync, replication, analytics
  src/workers/      scheduled maintenance jobs (BullMQ)
  src/test/         integration tests
frontend/src/       React + Vite SPA (pages, components, services, stores)
plan/               original design documents
audit/              readiness audits
```

## Deployment notes

- Serve the frontend and `/api` from the same site (for example, a reverse proxy that sends `/api` to the backend). The session is an HttpOnly, `SameSite=Lax` cookie.
- Set `BACKEND_URL` to the public `https://` URL: that makes cookies `Secure` and sets the OAuth redirect URI.
- Run a single backend instance, or move the rate limiter to Redis first.

## Known limitations

- Rebalance runs inside the backend process, one at a time per user. A restart during a rebalance stops it; running it again continues where it stopped.
- Moving a chunk during a rebalance can interrupt a download of that file that is already in progress.
- Rename, new-folder and delete prompts use the browser's built-in dialogs.
- The rate limiter keeps its counts in memory, so it is only correct with a single backend instance.
- Uploads are not resumable across a page reload: the chunks already stored are kept, but the browser starts the file again.

## License

TBD
