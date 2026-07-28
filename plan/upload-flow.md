# EkDrive — Upload Flow

## 1. Overview

The upload flow handles the complete lifecycle of getting a file from the user's browser into the EkDrive virtual filesystem, distributed across one or more Google Drive accounts.

## 2. Flow Diagram

```
┌──────────┐     ┌──────────────┐     ┌─────────────────┐     ┌──────────────┐
│  User     │────▶│  React SPA   │────▶│  API Gateway    │────▶│  File Service│
│ (selects  │     │  (chunking   │     │  (validate JWT, │     │  (create file│
│  file)    │     │   in Worker) │     │   rate limit)   │     │   record)    │
└──────────┘     └──────────────┘     └─────────────────┘     └──────┬───────┘
                                                                       │
                                                                       ▼
                                                              ┌──────────────┐
                                                              │ Storage Engine│
                                                              │ (select drives│
                                                              │  assign chunks)│
                                                              └──────┬───────┘
                                                                     │
                                                                     ▼
                                                              ┌──────────────┐
                                                              │ Background Job│
                                                              │ Queue (BullMQ)│
                                                              └──────┬───────┘
                                                                     │
                                                                     ▼
                                                              ┌──────────────┐
                                                              │ Upload Worker │
                                                              │ (upload chunks│
                                                              │  to Google    │
                                                              │  Drive)       │
                                                              └──────┬───────┘
                                                                     │
                                                                     ▼
                                                              ┌──────────────┐
                                                              │ Update Metadata│
                                                              │ (file status → │
                                                              │  ready, chunk  │
                                                              │  statuses →    │
                                                              │  uploaded)     │
                                                              └──────┬───────┘
                                                                     │
                                                                     ▼
                                                              ┌──────────────┐
                                                              │ WebSocket      │
                                                              │ (notify client │
                                                              │  upload done)  │
                                                              └──────────────┘
```

## 3. Step-by-Step Walkthrough

### Step 1: File Selection and Chunking (Client)

1. User selects a file via the file picker or drag-and-drop.
2. The React SPA passes the file to a Web Worker.
3. The Web Worker:
   - Splits the file into chunks using `File.slice()`.
   - Computes a checksum for each chunk (xxHash).
   - Computes a checksum for the complete file (SHA-256).
   - Returns the chunk metadata (index, size, checksum, blob reference) to the main thread.
4. The main thread prepares a `FormData` or `Request` payload with:
   - File metadata: name, size, mime type, total chunks, file checksum.
   - Chunk checksums array.
   - Optional: parent folder ID in the virtual filesystem.

### Step 2: Initiate Upload (API)

```
POST /api/files/upload/init
Headers:
  Authorization: Bearer <jwt>
  Content-Type: application/json

Body:
{
  "name": "video.mp4",
  "size_bytes": 157286400,
  "mime_type": "video/mp4",
  "parent_folder_id": "folder-uuid-xyz",
  "total_chunks": 3,
  "chunk_checksums": ["abc123...", "def456...", "ghi789..."],
  "file_checksum": "sha256:fullfilehash..."
}
```

**Server-side validation**:
- Authenticate user from JWT.
- Validate that `parent_folder_id` exists and belongs to the user (if provided).
- Validate that the user has sufficient total storage across all drives.
- Validate that `total_chunks * chunk_size` is consistent with `size_bytes`.

### Step 3: Storage Engine Placement

1. File Service calls the Storage Engine with the file metadata.
2. Storage Engine runs the placement algorithm based on the user's storage mode.
3. Storage Engine returns a placement plan:

```json
{
  "file_id": "file-uuid-abc",
  "placement": [
    { "chunk_index": 0, "drive_id": "drive-uuid-1", "chunk_size": 52428800 },
    { "chunk_index": 1, "drive_id": "drive-uuid-2", "chunk_size": 52428800 },
    { "chunk_index": 2, "drive_id": "drive-uuid-1", "chunk_size": 52428800 }
  ]
}
```

4. File Service creates the file record in PostgreSQL with status `uploading`.
5. File Service creates chunk records for each chunk with status `pending`.
6. File Service reserves space on each selected drive (decrements `available_quota_bytes`).

### Step 4: Queue Upload Jobs

1. File Service creates a BullMQ job for each chunk upload.
2. Jobs are added to the `upload` queue with:
   - Priority based on chunk index (sequential priority).
   - Attempts: 3 (retries).
   - Backoff: exponential (1s, 2s, 4s).
   - Rate limit: per-drive rate limiting applied by the worker.

### Step 5: Upload Worker Processes Chunks

1. Upload Worker picks up a job from the queue.
2. Worker fetches the chunk data from the client (via a presigned URL or direct upload to MinIO staging).
3. Worker retrieves the target drive's OAuth token from the database.
4. Worker uploads the chunk to Google Drive using the Drive API:

```
POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart
Authorization: Bearer <drive_access_token>
Content-Type: application/octet-stream

<chunk binary data>
```

5. Worker sets the `parent` folder to the drive's EkDrive root folder.
6. Worker names the chunk file using the naming convention: `ekdrive-chunk:<file_uuid>:<chunk_index>`.
7. On success:
   - Worker updates the chunk record with the Google Drive file ID and status `uploaded`.
   - Worker releases the space reservation (updates `used_quota_bytes` on the drive).
8. On failure:
   - Worker increments the retry count.
   - If retries exhausted, chunk status is set to `failed`.
   - File status is set to `partial`.

### Step 6: Completion Check

1. After each chunk upload succeeds, the worker checks if all chunks for the file are uploaded.
2. If all chunks are uploaded:
   - File status is updated to `ready`.
   - The file's `google_file_ids` array is populated with all chunk Google Drive file IDs.
   - The file's `checksum` is set to the pre-computed file checksum.
   - A WebSocket notification is sent to the client.
3. If some chunks failed:
   - File status remains `partial`.
   - The client is notified of which chunks need to be re-uploaded.

### Step 7: Client Notification

1. The client receives a WebSocket event:

```json
{
  "type": "upload_complete",
  "file_id": "file-uuid-abc",
  "status": "ready",
  "virtual_path": "/Documents/video.mp4"
}
```

Or for partial uploads:
```json
{
  "type": "upload_progress",
  "file_id": "file-uuid-abc",
  "status": "partial",
  "completed_chunks": [0, 2],
  "failed_chunks": [1]
}
```

## 4. Parallel Uploads

- Chunks are uploaded in parallel with a configurable concurrency limit (default 4).
- Each chunk is uploaded independently, so a failure in one chunk does not block others.
- The client can throttle concurrency based on network conditions.

## 5. Large File Handling

- Files larger than 1 GB are chunked by default.
- The client shows a progress bar per chunk and an overall progress indicator.
- The user can pause and resume uploads. Pausing cancels in-flight chunk uploads and marks them for retry on resume.

## 6. Error Handling

| Error | Action |
|---|---|
| Drive offline during upload | Reassign chunk to another online drive (if available). |
| Drive quota exceeded | Skip drive for remaining chunks, use other drives. |
| Chunk upload fails (network) | Retry with exponential backoff. |
| All retries exhausted | Mark chunk as `failed`, file as `partial`. |
| Google Drive API returns 403 | Check OAuth token validity, refresh if needed, retry. |
| Google Drive API returns 429 | Respect rate limit headers, back off, retry after delay. |