# EkDrive — Background Jobs

## 1. Overview

Background jobs handle asynchronous, long-running, or periodic tasks that should not block the main request-response cycle. The job system is built on BullMQ with Redis as the backend.

## 2. Job Categories

| Category | Queue Name | Worker Count (Default) | Priority |
|---|---|---|---|
| **Upload** | `upload` | 4 | Normal |
| **Download** | `download` | 4 | Normal |
| **Sync** | `sync` | 2 | Low |
| **Health Check** | `health` | 1 | Low |
| **Rebalance** | `rebalance` | 2 | Low |
| **Thumbnail Generation** | `thumbnail` | 2 | Low |
| **Cleanup** | `cleanup` | 1 | Low |
| **Notification** | `notification` | 1 | Normal |

## 3. Job Definitions

### 3.1 Upload Job

| Property | Value |
|---|---|
| **Queue** | `upload` |
| **Data** | `{ file_id, chunk_index, drive_id, chunk_size, checksum }` |
| **Attempts** | 3 |
| **Backoff** | Exponential: 1s, 2s, 4s |
| **Timeout** | 5 minutes per chunk |
| **Rate Limit** | Per-drive: 10 concurrent uploads, 100 MB/s |

**Lifecycle**:
1. Worker picks up the job.
2. Fetches chunk data from the client directly via the upload endpoint.
3. Retrieves the target drive's OAuth token.
4. Uploads the chunk to Google Drive.
5. Verifies the upload by checking the file size and checksum.
6. Updates the chunk record in the database.
7. If all chunks for the file are uploaded, marks the file as `ready`.

### 3.2 Download Job

| Property | Value |
|---|---|
| **Queue** | `download` |
| **Data** | `{ file_id, chunk_index, drive_id, google_file_id }` |
| **Attempts** | 3 |
| **Backoff** | Exponential: 1s, 2s, 4s |
| **Timeout** | 5 minutes per chunk |
| **Rate Limit** | Per-drive: 10 concurrent downloads, 100 MB/s |

**Lifecycle**:
1. Worker picks up the job.
2. Retrieves the target drive's OAuth token.
3. Fetches the chunk from Google Drive.
4. Verifies the chunk checksum.
5. Stores the chunk in Redis cache or streams directly to the client.
6. Updates the chunk record in the database.

### 3.3 Sync Job

| Property | Value |
|---|---|
| **Queue** | `sync` |
| **Data** | `{ drive_id, sync_token }` |
| **Attempts** | 5 |
| **Backoff** | Exponential: 2s, 4s, 8s, 16s, 32s |
| **Timeout** | 10 minutes |
| **Repeat** | Every 30 seconds |

**Lifecycle**:
1. Worker polls the Google Drive API for changes since `sync_token`.
2. Maps changes to virtual filesystem entries.
3. Creates or updates sync entries in the database.
4. Updates the `sync_token` for the drive.
5. Processes pending sync entries (applies changes to Google Drive).

### 3.4 Health Check Job

| Property | Value |
|---|---|
| **Queue** | `health` |
| **Data** | `{ drive_id }` |
| **Attempts** | 3 |
| **Backoff** | Exponential: 5s, 10s, 20s |
| **Timeout** | 30 seconds |
| **Repeat** | Every 60 seconds |

**Lifecycle**:
1. Worker runs the health check for the specified drive.
2. Checks token validity, API connectivity, and quota.
3. Updates the drive status in the database.
4. Creates a `health_checks` record.
5. If the drive status changed, triggers appropriate actions (reconnection, rebalancing, notifications).

### 3.5 Rebalance Job

| Property | Value |
|---|---|
| **Queue** | `rebalance` |
| **Data** | `{ user_id, mode, threshold }` |
| **Attempts** | 3 |
| **Backoff** | Exponential: 1s, 2s, 4s |
| **Timeout** | 30 minutes |
| **Repeat** | On demand or triggered by mode change |

**Lifecycle**:
1. Worker identifies over-utilized and under-utilized drives.
2. Selects files/chunks to migrate.
3. Copies chunks to target drives.
4. Verifies the copied chunks.
5. Updates `drive_assignments` and `chunks` records.
6. Deletes chunks from source drives.
7. Updates quota counters.
8. Reports completion status.

### 3.6 Thumbnail Generation Job

| Property | Value |
|---|---|
| **Queue** | `thumbnail` |
| **Data** | `{ file_id, google_file_id, mime_type }` |
| **Attempts** | 2 |
| **Backoff** | Exponential: 2s, 4s |
| **Timeout** | 2 minutes |

**Lifecycle**:
1. Worker fetches the first chunk of the file from Google Drive.
2. Generates a thumbnail based on the file type.
3. Stores the thumbnail in Redis cache.
4. Updates the file record with the thumbnail URL.

### 3.7 Cleanup Job

| Property | Value |
|---|---|
| **Queue** | `cleanup` |
| **Data** | `{ type: 'orphaned_chunks' | 'expired_share_links' | 'old_health_checks' }` |
| **Attempts** | 1 |
| **Repeat** | Daily at 02:00 UTC |

**Lifecycle**:
1. Worker identifies orphaned chunks (chunks with no parent file record).
2. Deletes orphaned chunks from Google Drive and MinIO.
3. Identifies expired share links.
4. Deletes expired share links from the database.
5. Identifies health check records older than 90 days.
6. Purges old health check records.

## 4. Job Priorities

| Priority | Value | Queues |
|---|---|---|
| Critical | 100 | Upload (urgent chunks), Download (user-initiated) |
| Normal | 50 | Upload, Download, Notification |
| Low | 10 | Sync, Health Check, Rebalance, Thumbnail, Cleanup |

## 5. Job Concurrency and Rate Limiting

- Each worker has a concurrency limit to avoid overwhelming Google Drive API.
- Per-drive rate limiting is enforced at the worker level.
- If a drive returns a 429 (Too Many Requests), the worker respects the `Retry-After` header and backs off.
- If a drive returns a 403 (Forbidden), the worker marks the drive as potentially offline and triggers a health check.

## 6. Job Monitoring

| Metric | Tool |
|---|---|
| Jobs queued | BullMQ UI / Redis INSPECT |
| Jobs completed/failed | BullMQ metrics + Prometheus |
| Job duration | Histogram metric per job type |
| Worker utilization | Gauge metric per worker |
| Failed job reasons | Counter metric by error type |

## 7. Job Retry and Dead Letter

- Jobs that fail after all retries are moved to a dead letter queue.
- Dead letter jobs are inspected manually or cleaned up by the cleanup job.
- Critical failures (e.g., all chunks of a file failed to upload) trigger user notifications.