# Audit — Frontend & Dashboard

Legend: ✅ Fully implemented · 🟡 Partial · ❌ Missing/Planned · 🐞 Bug · ⚠ Critical

## Feature Status

| Feature | Status | Notes |
|---|---|---|
| Dashboard (overview page) | ❌ | No dashboard route/page; app lands on `/files` |
| File Explorer UI | 🟡 | `FileList.tsx` renders, but queries placeholder API |
| Folder navigation | 🐞 | `folderId` param never drives the query |
| Upload UI | 🐞 | Upload button has no handler |
| File preview UI | ❌ | No preview component/modal |
| Search UI | 🐞 | Header search navigates but `FileList` ignores `q` |
| Settings UI | 🟡 | Static shell, one broken handler |
| Login / OAuth callback | ✅ | Works with the hash-redirect flow |
| Auth store / API client | 🟡 | Works, but systemic double `/api/v1` prefix bug |
| Sidebar navigation | 🐞 | Missing required props; three items → `/settings` |
| Responsiveness | 🟡 | Tailwind used; no verified breakpoints/mobile testing |
| Accessibility | ❌ | No aria labels, focus management, or keyboard nav verified |

## Routing & pages

- [App.tsx](file:///d:/Projects/EkDrive/frontend/src/App.tsx) defines only: `/files`, `/files/:folderId`, `/settings`, `/login`, `/auth/callback`.
  - ❌ No routes for dashboard, trash, search results, shares, drives, analytics, activity, or notifications — matching the missing backend for those modules.
  - 🐞 `<Sidebar />` is rendered with no props, but Sidebar requires `isCollapsed`/`onToggle` → TypeScript error / runtime undefined behavior.

## File Explorer

- [FileList.tsx](file:///d:/Projects/EkDrive/frontend/src/pages/FileList.tsx):
  - 🐞 Queries the placeholder `/files` route, which returns stub data (never the real `services/files.ts`).
  - 🐞 The `:folderId` route param is not fed into the query key/params, so navigating into folders doesn't refetch.
  - 🐞 Upload button renders but has no `onClick`/handler.
  - 🐞 Renders `file.drive_name`, a field the backend never returns.
  - Uses TanStack Query + virtualization deps, but the data contract is broken.

## Sidebar / Header

- 🐞 [Sidebar.tsx](file:///d:/Projects/EkDrive/frontend/src/components/Sidebar.tsx) hardcodes a user and points all three nav items to `/settings`.
- 🐞 [Header.tsx](file:///d:/Projects/EkDrive/frontend/src/components/Header.tsx) search box navigates to `/files?q=` (ignored downstream); notification bell is decorative.

## API client

- 🐞 [api.ts](file:///d:/Projects/EkDrive/frontend/src/services/api.ts) sets `baseURL` to `/api/v1`, yet [upload.ts](file:///d:/Projects/EkDrive/frontend/src/services/upload.ts), [download.ts](file:///d:/Projects/EkDrive/frontend/src/services/download.ts), and [useDriveHealth.ts](file:///d:/Projects/EkDrive/frontend/src/hooks/useDriveHealth.ts) prepend `/api/v1` **again** → requests hit `/api/v1/api/v1/...` (404).
- 401 handling redirects to login; token read from cookie.

## Non-functional

- ⚠ Accessibility: no evidence of aria attributes, semantic landmarks, focus traps in dialogs, or keyboard navigation. Would fail basic WCAG checks (full validation requires manual AT testing).
- 🟡 Responsiveness: Tailwind utility classes present; no confirmed mobile layout testing.
- No loading/empty/error states beyond a couple of placeholders; no toast/notification system.

**Verdict:** The frontend is a **visual scaffold**. Auth flow works; everything data-driven is broken by the double-prefix bug, placeholder endpoints, and unwired handlers. No real dashboard exists. **Not production-ready.**
