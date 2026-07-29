# Audit — Settings, Analytics & Notifications

Legend: ✅ Fully implemented · 🟡 Partial · ❌ Missing/Planned · 🐞 Bug · ⚠ Critical

## Feature Status

| Feature | Status | Notes |
|---|---|---|
| Profile settings | ❌ | No profile UI, no update endpoint |
| Storage settings (view usage) | ❌ | No aggregated usage endpoint or UI |
| Security settings (sessions/2FA) | ❌ | No Session model, no 2FA, no route |
| Preferences (theme/defaults) | ❌ | Not implemented |
| Connect drive from Settings | 🐞 | UI calls `/auth/connect` expecting `authUrl` JSON; backend redirects |
| Storage mode selection | 🟡 | Static "Balanced/Active" UI; not wired to backend |
| Analytics (usage over time) | ❌ | No route, no service, no schema (grep: 0 matches) |
| Analytics charts | ❌ | `recharts` is a dependency but unused |
| Notifications (in-app) | ❌ | No route, no service, no model |
| Notification bell | 🐞 | Present in `Header.tsx` but non-functional |

## Settings

- [Settings.tsx](file:///d:/Projects/EkDrive/frontend/src/pages/Settings.tsx) is a static UI shell:
  - 🐞 `handleConnectDrive()` posts to `/auth/connect` and expects `response.data.authUrl`, but the backend `/connect` route performs a **redirect** (302), not a JSON body — so `authUrl` is `undefined` and it silently falls into the catch branch every time.
  - Storage Mode section is hardcoded to "Balanced" / "Active" — no fetch, no selection handler, no persistence.
  - No profile fields (name, email, avatar), no security section (sessions, password, 2FA), no preferences.
- Backend has **no** settings/profile route. There is no endpoint to update `display_name` or `avatar_url`.
- ⚠ No session management: no `Session` model in the schema, so "log out other devices" / active-sessions is impossible.

**Verdict:** Settings is a **static mockup** with one broken drive-connect handler. Effectively **missing**.

## Analytics

- Grep across the backend for `analytics` returned **zero matches**.
- No aggregation of storage used, file counts, drive distribution, or upload/download history.
- `recharts` is installed in the frontend but not imported anywhere.
- No dashboard cards, no charts, no time-series data source.

**Verdict:** Analytics is **entirely missing**.

## Notifications

- Grep across the backend for `notification` returned **zero matches**.
- No `Notification` model, no route, no WebSocket push (the WS manager itself is broken and commented out — see 08/architecture).
- 🐞 [Header.tsx](file:///d:/Projects/EkDrive/frontend/src/components/Header.tsx) renders a notification bell icon with no click handler, no unread count, no data source.

**Verdict:** Notifications are **entirely missing** — bell is decorative only.

## Cross-cutting

- ⚠ Schema lacks the models these features require: `Session`, `Notification`, and any analytics/aggregation table or event log.
- The frontend router ([App.tsx](file:///d:/Projects/EkDrive/frontend/src/App.tsx)) has no routes for analytics or notifications; Settings is the only settings-adjacent page and three Sidebar nav items all point to `/settings`.
