# EkDrive

EkDrive joins several Google Drive accounts into one storage pool. You work with a single virtual drive; EkDrive splits files into chunks, places them across the connected accounts according to the storage mode, and puts them back together on download.

## Status

Working prototype — feature-complete for the flows below, not yet hardened for production. See [Known limitations](#known-limitations).

| Area | State |
|---|---|
| Google sign-in, connecting several accounts as drives | Working |
| Chunked upload (parallel, resumable), download, range streaming | Working |
| Folders (uploaded and downloaded whole), search, share links, trash | Working |
| Storage modes, rebalancing, self-repair | Working |
| Drive health, change sync | Working |
| Activity log, notifications, analytics dashboard | Working |
| Health page: conflicts, repair, per-drive uptime history | Working |
| Mobile layout, keyboard and screen-reader support | Basic |
| Live updates over server-sent events | Working |

## How it works

- **Accounts as drives.** The Google account you sign in with becomes your first drive; Settings → Connect Drive adds more. Each drive keeps its own OAuth tokens, encrypted with AES-256-GCM, and refreshes them on its own.
- **Chunks.** Files are split into `CHUNK_SIZE_BYTES` chunks (50 MB by default) and stored in an `EkDrive` folder on each account. Four chunks upload at a time. The browser computes an xxhash64 checksum per chunk; the server verifies it on upload and again on every download, and checks the whole-file hash when a complete file is downloaded.
- **Interrupted uploads resume.** Pick the same file again and only the missing chunks are sent. If a drive refuses a write mid-upload, that chunk moves to another drive with room instead of failing the upload.
- **Storage modes** — applied to new uploads, and to existing files when you rebalance:
  - *Balanced*: each chunk goes to the drive that stays least utilized.
  - *Maximum capacity*: each chunk goes to the drive with the most free space.
  - *High reliability*: each chunk is stored on at least two drives. Downloads fall back to another copy when one is missing or corrupt.
- **Folders** are virtual — they exist only in EkDrive's database, so moving and renaming never touches Google Drive. A folder can be uploaded whole and downloaded back as a zip that is built while it streams.
- **Names stay distinct.** A second `report.pdf` in the same folder is stored as `report (2).pdf`; renaming onto a taken name is refused.
- **Thumbnails.** Image files get a 256px thumbnail, made the first time the list asks for one and then kept in the database, so a folder of photos does not re-read every file from Google.
- **Trash.** Deleting moves an item to the trash for 30 days. Trashed files keep using Google space until they are purged.
- **Drive states.** `online`, `degraded` (nearly full), `quota_exceeded` (full), `reconnecting` (Google refused the stored credentials — use Reconnect in Settings) and `offline`. Only the first two take new chunks.
- **Self-repair.** When a chunk is deleted outside EkDrive, sync marks that copy missing, rebuilds it from another copy and notifies you. A file with no copy left is reported as damaged. `POST /api/v1/files/:id/repair` runs a repair on demand.
- **Transient Google failures are retried.** A throttled or failing Drive call (429, 5xx, a dropped connection) is retried up to four times with exponential backoff, honouring `Retry-After`. A refusal that retrying cannot fix is surfaced at once.
- **Live updates.** The open page subscribes to `/api/v1/events`, a server-sent stream, so a background sync, a drive going offline or a finished rebalance shows up without the user refreshing. Polling stays as a slow fallback.
- **Background jobs**: drive health every 15 minutes, change sync every 10 minutes, and a daily cleanup of abandoned uploads, expired trash, expired share links and old records. They run on timers inside the backend process; with `REDIS_URL` set they run as BullMQ repeatable jobs instead, which survives a restart mid-job and spreads the work across instances.

## Development setup

Requirements: Node 22+, pnpm 10, a PostgreSQL database, and a Google Cloud OAuth client (web application). Redis is optional — without it the background jobs run in-process.

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
| `REDIS_URL` | no | A `redis://` or `rediss://` TCP URL. Without it, jobs run on in-process timers |
| `BACKEND_URL`, `CORS_ORIGIN`, `PORT` | no | Defaults are localhost 3000 / 5173 |
| `CHUNK_SIZE_BYTES` | no | 50 MB by default |
| `MAX_FILE_SIZE_BYTES` | no | 10 GiB by default |
| `RATE_LIMIT_MAX`, `TRUST_PROXY` | no | Requests per minute per user (100). `TRUST_PROXY=true` only behind a proxy you control |
| `LOG_LEVEL` | no | `info` by default; `debug` for more, `silent` in tests |

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Backend (tsx watch) and frontend (Vite) together |
| `pnpm build` | Type-checks, bundles the backend to `backend/dist`, builds the frontend to `frontend/dist` |
| `pnpm test` | Unit tests in both packages |
| `pnpm --filter ekdrive-backend test:integration` | API tests against the real `DATABASE_URL` |
| `pnpm test:coverage` | Unit + integration with coverage thresholds (needs `DATABASE_URL`) |
| `pnpm lint` / `pnpm typecheck` | ESLint / `tsc --noEmit` in both packages |
| `pnpm db:migrate` | `prisma migrate deploy` using `.env.local` |
| `pnpm --filter ekdrive-backend start` | Runs the built backend |

## Testing

- **Unit tests** cover chunk placement for each storage mode, encryption round-trips, checksums, path handling and header building. They need no database.
- **Coverage** is measured over the unit and integration suites together, since the routes are covered through the HTTP app. Backend thresholds are 70% lines / 70% functions / 75% branches; the frontend's are set at what its suite covers today and should rise as pages gain tests.
- **Integration tests** drive the real HTTP app against the database in `DATABASE_URL`, with only Google Drive replaced by an in-memory store. They cover the upload → download path, replicas and fallback, trash, range requests, repair, rebalance, share links, ownership isolation, activity, notifications and analytics. They create their own users and delete everything afterwards, but they do write to that database — point `DATABASE_URL` at a development one.

CI runs typecheck, lint, the full test suite with coverage against a PostgreSQL service container, and a production build on every push and pull request.

## API

All routes are under `/api/v1` and need the session cookie, except `/auth/login`, `/auth/callback` and `/shares/public/*`.

| Group | Routes |
|---|---|
| `auth` | `login`, `callback`, `connect`, `me`, `logout` (optionally everywhere) |
| `files` | list, recent, search, issues, breadcrumbs, create folder, rename/move, trash, `:id/download`, `:id/archive`, `:id/preview`, `:id/thumbnail`, `:id/repair` |
| `upload` | `init`, `:id/status`, `:id/chunk/:index`, `:id/complete`, abort |
| `trash` | list, restore, delete one, empty |
| `drives` | list, get, disconnect, health check |
| `storage-mode` | get, set, rebalance |
| `shares` | create, list, revoke, `public/:token`, `public/:token/content` |
| `sync` | status, trigger, conflicts, resolve |
| `drives/:id/health` | `POST` runs a check, `GET` returns recent checks with uptime |
| `activity`, `notifications`, `analytics` | activity feed, notification list/read, dashboard figures |
| `events` | server-sent stream of this user's changes |

## Project layout

```
docker-compose.yml  PostgreSQL, Redis, the API and nginx
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

## Running it with Docker

```bash
cp .env.example .env.local        # fill in the Google credentials and the three secrets
docker compose up -d --build      # http://localhost:8080
```

Compose brings up PostgreSQL, Redis, the API and an nginx that serves the built frontend and
passes `/api` to the API, so everything is on one origin. Migrations run when the API
container starts. Set `BACKEND_URL` and `CORS_ORIGIN` to the address people actually use, and
register `<BACKEND_URL>/api/v1/auth/callback` in Google Cloud Console.

> These container files have not been built on this machine — Docker is not installed here —
> so treat the first `docker compose up` as the thing that proves them.

## Deployment notes

- Serve the frontend and `/api` from the same site (for example, a reverse proxy that sends `/api` to the backend). The session is an HttpOnly, `SameSite=Strict` cookie, and writes are additionally checked against the `Origin` header.
- Set `BACKEND_URL` to the public `https://` URL: that makes cookies `Secure` and sets the OAuth redirect URI.
- Run a single backend instance, or move the rate limiter to Redis first.
- Logs are JSON on stdout, one line per request, carrying a request id that is also returned as `X-Request-Id` and included in 500 responses. Pass your own `X-Request-Id` to trace a call end to end.

## Security notes

- Each drive's OAuth tokens are encrypted with AES-256-GCM before they are stored, and only the `drive.file` scope is requested.
- The session is a 7-day HttpOnly `SameSite=Strict` cookie. Settings → Sign out everywhere moves a per-user timestamp forward, which retires every token already issued.
- Writes that arrive with a cookie must carry an `Origin` header matching this deployment.
- Every signed-in request is rate limited per user, with tighter budgets for rebalance and sync; unauthenticated requests are limited per IP.
- Responses carry a locked-down `Content-Security-Policy` and `Permissions-Policy`; inline previews are served with their own sandboxed policy.

## Known limitations

- Rebalance runs inside the backend process, one at a time per user. A restart during a rebalance stops it; running it again continues where it stopped.
- Without `REDIS_URL` the scheduled jobs live in the backend process, so they assume a single instance and a job interrupted by a restart waits for its next tick.
- Moving a chunk during a rebalance can interrupt a download of that file that is already in progress.
- Rename, new-folder and delete prompts use the browser's built-in dialogs.
- Files are moved through a folder picker rather than drag-and-drop. Bulk delete and move run one request per item, so a large selection takes a moment.
- The rate limiter keeps its counts in memory, so it is only correct with a single backend instance.
- Resuming an upload matches a file by name, size and modification time, so editing a file before resuming would mix old and new chunks. Renaming it first forces a clean upload.

## License

TBD
