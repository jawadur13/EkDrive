# EkDrive — Sync Engine

## 1. Purpose

The Sync Engine keeps the EkDrive virtual filesystem consistent with the underlying Google Drive accounts. It detects changes, resolves conflicts, and propagates updates bidirectionally.

## 2. Change Detection

### 2.1 Virtual Filesystem Changes (EkDrive → Google Drive)

When a user creates, modifies, or deletes a file in the EkDrive virtual filesystem, the change is recorded as a sync entry:

| Operation | Sync Entry |
|---|---|
| File created | `operation=create`, `sync_status=pending` |
| File modified | `operation=update`, `sync_status=pending` |
| File deleted | `operation=delete`, `sync_status=pending` |
| File renamed | `operation=rename`, `sync_status=pending` |
| File moved | `operation=move`, `sync_status=pending` |

### 2.2 Google Drive Changes (Google Drive → EkDrive)

The Sync Engine also monitors Google Drive for changes made outside of EkDrive (e.g., via the Google Drive web interface or another app):

1. A periodic polling job queries the Google Drive API for changes since the last sync token.
2. Changes are mapped to the virtual filesystem using the `google_file_ids` mapping.
3. If a change affects a file in the virtual filesystem, a sync entry is created with `sync_status=pending`.
4. If a change affects a file outside EkDrive's root folder, it is ignored.

### 2.3 Sync Token Management

- Each connected drive maintains a `sync_token` (Google Drive change token).
- The sync token is stored in the `drives` table as `sync_token`.
- After each poll, the sync token is updated to the latest token returned by the Drive API.
- If the sync token becomes invalid (e.g., after a long period of inactivity), a full resync is triggered.

## 3. Conflict Resolution

### 3.1 Conflict Detection

A conflict occurs when the same file is modified in both the virtual filesystem and Google Drive since the last sync.

Conflict detection logic:
1. Compare the `updated_at` timestamp of the virtual file with the `modifiedTime` from Google Drive.
2. If both have changed since the last successful sync, a conflict exists.

### 3.2 Conflict Resolution Strategies

| Strategy | Behavior | When Used |
|---|---|---|
| `local_wins` | The virtual filesystem version overwrites the Google Drive version. | Default for most operations. |
| `remote_wins` | The Google Drive version overwrites the virtual filesystem version. | When the change originated from outside EkDrive. |
| `manual` | The conflict is flagged and the user must choose which version to keep. | For critical files or when both versions have significant changes. |
| `merge` | Attempt to merge changes (for text files). If merge fails, fall back to `manual`. | For text-based files (markdown, JSON, code). |

### 3.3 Conflict Resolution Flow

```
1. Sync Engine detects a conflict.
2. Check the file's conflict resolution setting:
   a. If `manual`: create a conflict entry and notify the user.
   b. If `local_wins` or `remote_wins`: apply the winning version automatically.
   c. If `merge`: attempt a three-way merge for text files.
3. For automatic resolution:
   a. Apply the winning version.
   b. Update sync entry status to `synced`.
   c. Notify the user of the resolution.
4. For manual resolution:
   a. Create a conflict record in the database.
   b. Notify the user via WebSocket and email.
   c. Present both versions in the UI for the user to choose.
```

## 4. Sync Execution

### 4.1 Sync Job Processing

1. Sync entries with `sync_status=pending` are picked up by the Sync Worker.
2. The worker processes entries in chronological order.
3. For each entry:
   a. Look up the file's current state in the virtual filesystem.
   b. Look up the corresponding Google Drive file ID(s).
   c. Execute the appropriate Google Drive API operation.
   d. Update the sync entry status to `synced` or `failed`.

### 4.2 Sync Operations

| Operation | Google Drive API Call |
|---|---|
| `create` | `POST /drive/v3/files` (create new file) |
| `update` | `PATCH /drive/v3/files/:file_id` (update file content or metadata) |
| `delete` | `DELETE /drive/v3/files/:file_id` (trash the file) |
| `rename` | `PATCH /drive/v3/files/:file_id` (update `name` field) |
| `move` | `PATCH /drive/v3/files/:file_id` (update `parents` field) |

### 4.3 Sync Error Handling

| Error | Action |
|---|---|
| Drive offline | Retry later; mark sync entry as `pending`. |
| Google Drive API 404 | File may have been deleted externally. Mark as `conflict` for manual resolution. |
| Google Drive API 403 | Check permissions; mark as `failed`. |
| Google Drive API 429 | Respect rate limit; retry with backoff. |
| Checksum mismatch | Re-upload the file from the virtual filesystem. |
| Sync entry older than 7 days with `failed` status | Mark as `stale` and notify user. |

## 5. Offline Sync

### 5.1 Offline Editing

- The client can mark files as "available offline" using the Service Worker cache.
- When a user edits a file offline, the change is recorded locally.
- On reconnection, the sync engine processes pending changes.

### 5.2 Conflict Detection for Offline Edits

- Offline edits are tracked with a local timestamp and a hash of the local content.
- On reconnection, the sync engine compares the local hash with the remote hash.
- If the hashes differ, a conflict is detected and the appropriate resolution strategy is applied.

## 6. Sync Scheduling

| Sync Type | Frequency | Trigger |
|---|---|---|
| **Polling** | Every 30 seconds | Background job on each connected drive |
| **Event-driven** | Immediate | User-initiated file operations |
| **Full resync** | On demand or when sync token is invalid | Manual trigger or automatic on token expiry |
| **Conflict check** | After each sync batch | Automatic |

## 7. Sync State Tracking

Each drive maintains a sync state record:

| Field | Description |
|---|---|
| `last_sync_time` | Timestamp of the last successful sync |
| `sync_token` | Google Drive change token for incremental sync |
| `pending_changes` | Count of pending sync entries |
| `last_error` | Last sync error message (if any) |
| `is_syncing` | Boolean indicating if a sync is currently in progress |