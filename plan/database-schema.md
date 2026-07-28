# EkDrive — Database Schema

## 1. Overview

The primary database is PostgreSQL. The schema is organized into the following domains:

- **Auth**: Users, sessions, OAuth tokens
- **Drives**: Connected Google Drive accounts
- **Files**: Virtual filesystem entries (files and folders)
- **Chunks**: File chunk metadata for chunked uploads
- **Storage Modes**: Per-user storage mode configuration
- **Health**: Drive health status and history
- **Sync**: Change tracking and conflict resolution
- **Sharing**: File sharing links and permissions

## 2. Entity Relationship Diagram (Text)

```
users
├── auth_tokens (1:1)
├── drives (1:N)
├── files (1:N)
├── storage_modes (1:1)
├── share_links (1:N)
└── health_preferences (1:1)

drives
├── files (1:N, via chunk assignments)
├── chunks (1:N)
├── health_checks (1:N)
└── sync_state (1:1)

files
├── chunks (1:N, for chunked files)
├── parent_folder (self-ref: many files in one folder)
└── share_links (1:N)

chunks
├── drive (N:1)
└── file (N:1)

share_links
├── file (N:1)
└── user (N:1, owner)
```

## 3. Table Definitions

### 3.1 `users`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK, default gen_random_uuid() | Unique user identifier |
| `email` | VARCHAR(255) | UNIQUE, NOT NULL | User's email address |
| `display_name` | VARCHAR(255) | | User's display name |
| `avatar_url` | TEXT | | URL to user's avatar |
| `storage_mode` | VARCHAR(20) | NOT NULL, default 'balanced' | Active storage mode: `max_capacity`, `balanced`, `high_reliability` |
| `max_storage_gb` | INTEGER | | Optional per-user storage cap (NULL = unlimited) |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now() | Account creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default now() | Last update timestamp |

### 3.2 `auth_tokens`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK | |
| `user_id` | UUID | FK → users(id), UNIQUE | One token per user (refresh token rotation) |
| `access_token` | TEXT | NOT NULL | Current access token (encrypted at rest) |
| `refresh_token` | TEXT | NOT NULL | Refresh token (encrypted at rest) |
| `token_expiry` | TIMESTAMPTZ | NOT NULL | When the access token expires |
| `scopes` | TEXT[] | | Granted OAuth scopes |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now() | |
| `revoked_at` | TIMESTAMPTZ | | When the token was revoked |

### 3.3 `drives`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK | |
| `user_id` | UUID | FK → users(id), NOT NULL | Owner of this drive connection |
| `drive_name` | VARCHAR(255) | NOT NULL | User-assigned label (e.g., "Work Drive", "Personal") |
| `google_drive_id` | VARCHAR(255) | NOT NULL, UNIQUE | The Google Drive resource ID |
| `drive_type` | VARCHAR(20) | NOT NULL | `personal` or `business` (from Google Workspace) |
| `root_folder_id` | VARCHAR(255) | NOT NULL | Google Drive folder ID for EkDrive's root in this account |
| `total_quota_bytes` | BIGINT | | Total storage quota (from Drive API) |
| `used_quota_bytes` | BIGINT | | Currently used storage |
| `available_quota_bytes` | BIGINT | Computed: total - used | Free space available |
| `oauth_token_encrypted` | TEXT | NOT NULL | Encrypted OAuth2 token for this drive |
| `token_expiry` | TIMESTAMPTZ | | When the OAuth token expires |
| `status` | VARCHAR(20) | NOT NULL, default 'online' | `online`, `offline`, `reconnecting`, `quota_exceeded` |
| `last_health_check` | TIMESTAMPTZ | | Timestamp of last successful health check |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default now() | |

**Indexes**: `idx_drives_user_id` on `user_id`; `idx_drives_status` on `status`.

### 3.4 `files`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK | |
| `user_id` | UUID | FK → users(id), NOT NULL | Owner |
| `parent_id` | UUID | FK → files(id), nullable | Parent folder (NULL for root) |
| `name` | VARCHAR(1024) | NOT NULL | File or folder name |
| `virtual_path` | TEXT | NOT NULL | Full virtual path (e.g., `/Documents/photos/vacation.jpg`) |
| `is_folder` | BOOLEAN | NOT NULL, default false | True for folders, false for files |
| `mime_type` | VARCHAR(255) | | MIME type (NULL for folders) |
| `size_bytes` | BIGINT | | File size in bytes (NULL for folders) |
| `checksum` | VARCHAR(64) | | SHA-256 or xxHash of the complete file |
| `google_file_ids` | TEXT[] | | Array of Google Drive file IDs (for chunked files, one per chunk) |
| `drive_assignments` | JSONB | | Mapping of chunk index → drive ID. Example: `{"0": "drive-uuid-1", "1": "drive-uuid-2"}` |
| `chunk_count` | INTEGER | default 0 | Number of chunks (0 for non-chunked files) |
| `is_chunked` | BOOLEAN | NOT NULL, default false | True if file is split across multiple chunks |
| `redundancy_copies` | INTEGER | default 1 | Number of redundant copies (1 = no redundancy) |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default now() | |

**Indexes**: `idx_files_user_id` on `user_id`; `idx_files_parent_id` on `parent_id`; `idx_files_virtual_path` on `virtual_path` (unique per user); GIN index on `google_file_ids`.

### 3.5 `chunks`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK | |
| `file_id` | UUID | FK → files(id), NOT NULL | Parent file |
| `drive_id` | UUID | FK → drives(id), NOT NULL | Drive where this chunk is stored |
| `chunk_index` | INTEGER | NOT NULL | Zero-based index of this chunk within the file |
| `google_file_id` | VARCHAR(255) | NOT NULL | Google Drive file ID for this chunk |
| `size_bytes` | BIGINT | NOT NULL | Size of this chunk in bytes |
| `checksum` | VARCHAR(64) | NOT NULL | Integrity checksum for this chunk |
| `upload_status` | VARCHAR(20) | NOT NULL, default 'pending' | `pending`, `uploading`, `uploaded`, `failed`, `retrying` |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default now() | |

**Indexes**: `idx_chunks_file_id` on `file_id`; `idx_chunks_drive_id` on `drive_id`; unique on `(file_id, chunk_index)`.

### 3.6 `storage_modes`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK | |
| `user_id` | UUID | FK → users(id), UNIQUE | |
| `mode` | VARCHAR(20) | NOT NULL | `max_capacity`, `balanced`, `high_reliability` |
| `min_replicas` | INTEGER | default 1 | Minimum number of copies for each chunk (overrides per-file setting in high reliability) |
| `rebalance_threshold` | FLOAT | default 0.2 | Rebalance when any drive exceeds this fraction above the average utilization |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default now() | |

### 3.7 `health_checks`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK | |
| `drive_id` | UUID | FK → drives(id), NOT NULL | |
| `status` | VARCHAR(20) | NOT NULL | `healthy`, `degraded`, `offline` |
| `latency_ms` | INTEGER | | Response latency of the health check |
| `quota_available` | BIGINT | | Available quota at time of check |
| `error_message` | TEXT | | Error details if status is not healthy |
| `checked_at` | TIMESTAMPTZ | NOT NULL, default now() | |

**Indexes**: `idx_health_checks_drive_id` on `drive_id`; `idx_health_checks_checked_at` on `checked_at`.

### 3.8 `sync_entries`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK | |
| `user_id` | UUID | FK → users(id), NOT NULL | |
| `file_id` | UUID | FK → files(id) | NULL for folder-level sync entries |
| `drive_id` | UUID | FK → drives(id) | The drive where the change originated |
| `google_file_id` | VARCHAR(255) | | Google Drive file ID involved in the change |
| `operation` | VARCHAR(20) | NOT NULL | `create`, `update`, `delete`, `rename`, `move` |
| `sync_status` | VARCHAR(20) | NOT NULL, default 'pending' | `pending`, `synced`, `conflict`, `failed` |
| `conflict_resolution` | VARCHAR(20) | | `local_wins`, `remote_wins`, `manual` |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now() | |
| `resolved_at` | TIMESTAMPTZ | | When the sync was completed |

**Indexes**: `idx_sync_user_id` on `user_id`; `idx_sync_status` on `sync_status`; `idx_sync_drive_id` on `drive_id`.

### 3.9 `share_links`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK | |
| `user_id` | UUID | FK → users(id), NOT NULL | Owner of the share link |
| `file_id` | UUID | FK → files(id), NOT NULL | File being shared |
| `token` | VARCHAR(64) | NOT NULL, UNIQUE | Random token for the share URL |
| `expires_at` | TIMESTAMPTZ | | Expiration timestamp (NULL = never) |
| `max_downloads` | INTEGER | | Maximum number of downloads (NULL = unlimited) |
| `download_count` | INTEGER | default 0 | Current download count |
| `permissions` | VARCHAR(20) | NOT NULL, default 'view' | `view`, `download`, `edit` |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now() | |

**Indexes**: `idx_share_links_token` on `token`; `idx_share_links_user_id` on `user_id`.

## 4. Migration Strategy

- Use Prisma Migrate for schema versioning.
- Each migration is a numbered SQL file in `prisma/migrations/`.
- Rollback migrations are provided for each step.
- Seed data (e.g., storage mode defaults) is handled via seed scripts.

## 5. Indexing Strategy

- All foreign key columns are indexed.
- `virtual_path` is indexed with a unique partial index per user (using a composite index on `user_id` + `virtual_path`).
- `google_file_ids` uses a GIN index for array containment queries.
- Time-based columns (`created_at`, `updated_at`, `checked_at`) are indexed for common range queries.
- JSONB columns (`drive_assignments`) use GIN indexes for querying specific drive assignments.

## 6. Data Retention

- `health_checks` are retained for 90 days; older records are purged by a scheduled job.
- `sync_entries` older than 30 days with `synced` status are archived.
- Failed chunk uploads older than 7 days are cleaned up.