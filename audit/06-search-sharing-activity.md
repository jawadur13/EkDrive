# Audit — Search, Sharing & Activity

Legend: ✅ Fully implemented · 🟡 Partial · ❌ Missing/Planned · 🐞 Bug · ⚠ Critical

## Feature Status

| Feature | Status | Notes |
|---|---|---|
| File/folder search | 🟡 | Real `searchFiles()` service exists but is never called by a route |
| Search API endpoint | ❌ | No `/search` route; `files.ts` `/search` shadowed by `/:fileId` |
| Search filters (type/date/size) | ❌ | Not implemented anywhere |
| Search UI | ❌ | `Header.tsx` search navigates to `/files?q=` but `FileList` ignores `q` |
| Create share link | 🟡 | `routes/shares.ts` returns placeholder token only |
| List shares | ❌ | Returns hardcoded empty array |
| Access shared file (public) | ❌ | `/:token` returns placeholder `fileId: 'placeholder'` |
| Revoke share | ❌ | Echoes id; no DB write |
| Share permissions/expiry | ❌ | Not implemented |
| Activity log | ❌ | No route, no service, no schema model (grep: 0 matches) |
| Activity feed UI | ❌ | No page/component |

## Search

- Service [searchFiles()](file:///d:/Projects/EkDrive/backend/src/services/files.ts#L116-L127) performs a real case-insensitive `contains` query over `name` and `virtual_path`. It is **never wired to any route**.
- 🐞 In [files.ts](file:///d:/Projects/EkDrive/backend/src/routes/files.ts), the `/search` route (if present) is registered after `/:fileId`, so `/search` is captured as a `fileId` param — route shadowing.
- 🐞 Frontend [Header.tsx](file:///d:/Projects/EkDrive/frontend/src/components/Header.tsx) pushes `/files?q=<term>` but [FileList.tsx](file:///d:/Projects/EkDrive/frontend/src/pages/FileList.tsx) never reads the `q` query param — search is a dead UI.
- No filters, no pagination, no full-text index, no debounce.

**Verdict:** A working search *primitive* exists in the service layer but is completely disconnected end-to-end. Effectively **missing**.

## Sharing

- [shares.ts](file:///d:/Projects/EkDrive/backend/src/routes/shares.ts#L1-L21) is 100% placeholder:
  - `POST /` returns `token: 'placeholder-token'` without creating a `ShareLink` row.
  - `GET /` always returns `{ shares: [] }`.
  - `GET /:token` returns `{ fileId: 'placeholder' }` — no lookup, no access control.
  - `DELETE /:shareId` echoes the id without deleting anything.
- ⚠ A `ShareLink` model exists in the Prisma schema but is never read or written by any code path.
- No frontend page for sharing; no share dialog, no copy-link, no expiry/permission UI.
- ⚠ Security: because `/:token` returns a placeholder regardless of input, there is no auth boundary — the design intent (public unauthenticated access) is not backed by any validation of ownership, expiry, or revocation.

**Verdict:** Sharing is **planned only** — schema model present, but the entire runtime is placeholder.

## Activity

- Grep for `activity|analytics|notification` across the backend returned **zero matches**.
- No `Activity` model in [schema.prisma](file:///d:/Projects/EkDrive/backend/prisma/schema.prisma), no route, no service.
- No frontend activity page or component.

**Verdict:** Activity logging is **entirely missing** — not even scaffolded.

## Cross-cutting issues

- 🐞 [services/files.ts](file:///d:/Projects/EkDrive/backend/src/services/files.ts#L4) instantiates its own `new PrismaClient()` instead of the shared singleton.
- 🐞 [getOAuthClient()](file:///d:/Projects/EkDrive/backend/src/services/files.ts#L157-L164) never calls `.setCredentials()`, so any Drive call it feeds is unauthenticated (shared root-cause bug).
- 🐞 Hardcoded scrypt salt `'salt'` in the inline `decrypt()` helper.
- 🐞 `require('google-auth-library')` used in an ESM module.
