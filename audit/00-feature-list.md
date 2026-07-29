# EkDrive — Required Feature List

This is the feature list the audit was performed against. Each feature is classified in the module reports (01–09) and aggregated in [summary.md](file:///d:/Projects/EkDrive/audit/summary.md).

Legend: ✅ fully implemented · 🟡 partially implemented · ❌ missing · 🐞 has bugs · ⚠ critical issue

---

## 1. Authentication — [report](file:///d:/Projects/EkDrive/audit/01-authentication.md)
- Google OAuth 2.0 login — 🟡
- OAuth callback handling — 🟡
- PKCE flow (code_verifier) — 🐞 never passed
- JWT session tokens — 🟡 (hardcoded fallback secret ⚠)
- Encrypted OAuth token storage — 🟡 (hardcoded salt ⚠)
- Logout / session management — ❌

## 2. Dashboard — [report](file:///d:/Projects/EkDrive/audit/09-frontend-dashboard.md)
- Dashboard overview page — ❌

## 3. File Management — [report](file:///d:/Projects/EkDrive/audit/02-file-folder-management.md)
- Create / rename / move / delete file — 🟡 (services exist, routes placeholder)
- File metadata / listing — 🟡

## 4. Folder Management — [report](file:///d:/Projects/EkDrive/audit/02-file-folder-management.md)
- Create / rename / move / delete folder — 🟡
- Folder navigation — 🐞

## 5. File Explorer (frontend) — [report](file:///d:/Projects/EkDrive/audit/09-frontend-dashboard.md)
- Browse files/folders UI — 🟡 (queries placeholder endpoint)
- Drag & drop — 🟡

## 6. File Preview — [report](file:///d:/Projects/EkDrive/audit/02-file-folder-management.md)
- Preview / streaming UI — ❌

## 7. Upload System — [report](file:///d:/Projects/EkDrive/audit/03-upload-download.md)
- File upload — 🐞 (body mismatch, fake file id, non-existent status field)
- Resumable uploads — ❌
- Chunked upload integration — 🟡

## 8. Download System — [report](file:///d:/Projects/EkDrive/audit/03-upload-download.md)
- File download — 🐞
- Chunk reassembly — ❌
- ZIP / multi-file download — ❌
- Resume support — ❌

## 9. Storage — [report](file:///d:/Projects/EkDrive/audit/04-storage-drives-chunking.md)
- Storage engine (chunk placement) — 🐞 single-placement bug

## 10. Connected Drives — [report](file:///d:/Projects/EkDrive/audit/04-storage-drives-chunking.md)
- Connect / list / manage drives API — ❌ (routes 100% placeholder)
- Connect-drive from Settings — 🐞 contract mismatch

## 11. Storage Modes — [report](file:///d:/Projects/EkDrive/audit/04-storage-drives-chunking.md)
- max_capacity / balanced / high_reliability — 🟡 (not honored by engine)

## 12. Chunking Engine — [report](file:///d:/Projects/EkDrive/audit/04-storage-drives-chunking.md)
- Split / checksum (xxhash) — ✅ (not wired into working upload path)

## 13. Synchronization — [report](file:///d:/Projects/EkDrive/audit/05-sync-health-trash.md)
- Bidirectional sync + conflict resolution — 🟡 (references missing schema fields)
- Sync workers — ❌ never started

## 14. Drive Health — [report](file:///d:/Projects/EkDrive/audit/05-sync-health-trash.md)
- Health monitoring — 🟡
- Health workers — ❌ never started

## 15. Trash — [report](file:///d:/Projects/EkDrive/audit/05-sync-health-trash.md)
- Soft delete / restore / purge — ❌ entirely missing

## 16. Search — [report](file:///d:/Projects/EkDrive/audit/06-search-sharing-activity.md)
- Search service — 🟡 (never wired to route)
- Search API route — ❌ (shadowed by /:fileId)
- Filters — ❌
- Search UI — 🐞 (`q` ignored by FileList)

## 17. Sharing — [report](file:///d:/Projects/EkDrive/audit/06-search-sharing-activity.md)
- Create share link — 🟡
- List shares — ❌
- Access shared file — ❌
- Revoke share — ❌ (shares.ts 100% placeholder)

## 18. Activity — [report](file:///d:/Projects/EkDrive/audit/06-search-sharing-activity.md)
- Activity log — ❌ entirely missing (no schema model)

## 19. Settings — [report](file:///d:/Projects/EkDrive/audit/07-settings-analytics-notifications.md)
- Profile settings — ❌
- Storage settings — ❌
- Security settings — ❌
- Preferences — ❌ (Settings.tsx static shell)

## 20. Analytics — [report](file:///d:/Projects/EkDrive/audit/07-settings-analytics-notifications.md)
- Analytics data / dashboards — ❌
- Charts — ❌ (recharts installed but unused)

## 21. Notifications — [report](file:///d:/Projects/EkDrive/audit/07-settings-analytics-notifications.md)
- Notification system — ❌ (no schema model)
- Notification bell — 🐞 decorative only

## 22. Security — [report](file:///d:/Projects/EkDrive/audit/08-security.md)
- JWT verification — 🟡
- Token encryption — 🟡
- Rate limiting — ❌ (3-line stub)
- Security headers (helmet) — 🐞 incompatible with Hono
- PKCE — 🐞
- CSRF protection — ❌
- Zod validation — 🟡
- Secrets management — ⚠ hardcoded
- Token transport — ⚠ via URL hash
- Authorization checks — 🟡
