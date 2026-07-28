# EkDrive — Chunking System

## 1. Purpose

The Chunking System handles splitting large files into manageable pieces (chunks) and reassembling them during download. This enables:
- Uploading files larger than any single connected drive's free space.
- Parallel uploads of chunks for better throughput.
- Resumable uploads (failed chunks can be retried independently).
- Distributed storage across multiple drives for redundancy.

## 2. Chunking Strategy

### 2.1 Chunk Size

| Parameter | Default | Description |
|---|---|---|
| `chunk_size_bytes` | 50 MB | Target size for each chunk |
| `min_chunk_size_bytes` | 10 MB | Minimum chunk size; files smaller than this are stored as a single chunk |
| `max_chunk_size_bytes` | 250 MB | Hard upper limit for a single chunk |

**Chunk size selection logic**:
- If `file_size <= min_chunk_size`: store as a single chunk (no chunking).
- If `min_chunk_size < file_size <= max_chunk_size`: use `chunk_size_bytes` as the chunk size.
- If `file_size > max_chunk_size`: use `max_chunk_size_bytes` as the chunk size to limit the number of chunks.
- The actual chunk size may be adjusted dynamically if a drive has less free space than the target chunk size.

### 2.2 Chunk Naming Convention

Chunks are stored in Google Drive with a naming convention that links them to the parent file:

```
<original_filename>.chunk.<chunk_index> of <total_chunks>
```

Example: `report.pdf.chunk.0 of 5`

The actual Google Drive file name includes the EkDrive internal prefix:
```
ekdrive-chunk:<file_uuid>:<chunk_index>
```

This prefix allows the system to identify chunks programmatically without parsing the display name.

### 2.3 Chunk Integrity

Each chunk is checksummed before upload and after download:

| Property | Algorithm | Purpose |
|---|---|---|
| `checksum` | xxHash (64-bit) or SHA-256 | Integrity verification of each chunk |
| `file_checksum` | SHA-256 of the complete file | Integrity verification of the reassembled file |

**Verification flow**:
1. Client computes chunk checksum before upload (in Web Worker).
2. Server verifies chunk checksum after upload to Google Drive.
3. On download, server verifies chunk checksum after fetching from Google Drive.
4. On reassembly, server verifies the complete file checksum.
5. If any checksum fails, the chunk is re-fetched or re-uploaded.

## 3. Chunk Upload Process

### 3.1 Client-Side Chunking

```
1. User selects a file for upload.
2. Web Worker reads the file in chunks using File.slice().
3. For each chunk:
   a. Compute checksum (xxHash).
   b. Store chunk in a temporary ArrayBuffer or Blob.
   c. Queue chunk for upload.
4. Send metadata (file name, size, mime type, chunk count, checksums) to the backend.
5. Upload chunks in parallel (configurable concurrency, default 4).
```

### 3.2 Server-Side Chunk Handling

```
1. File Service receives upload metadata.
2. Storage Engine selects drives for each chunk based on storage mode.
3. Creates file record in database (status: 'uploading').
4. Creates chunk records in database (status: 'pending').
5. Background job picks up each chunk upload task.
6. Job fetches chunk data from the client (or MinIO staging area).
7. Job uploads chunk to the selected Google Drive account.
8. Job updates chunk status to 'uploaded' and records the Google Drive file ID.
9. When all chunks are uploaded:
   a. Update file record status to 'ready'.
   b. Compute and store the complete file checksum.
   c. Notify client via WebSocket.
```

### 3.3 Resumable Uploads

If a chunk upload fails:
1. The chunk status is set to `failed`.
2. The job retries up to `max_retries` (default 3) with exponential backoff.
3. If all retries fail, the file status is set to `partial`.
4. The client can query which chunks are missing and re-upload only those.
5. On successful re-upload of all missing chunks, the file status returns to `ready`.

## 4. Chunk Download Process

### 4.1 Chunk Fetching

```
1. Download Service receives a file download request.
2. Looks up the file's chunk assignments from the database.
3. For each chunk:
   a. Determine which drive holds the chunk.
   b. Check if the drive is online.
   c. If online: fetch the chunk from Google Drive.
   d. If offline: attempt to fetch from a redundant copy on another drive (High Reliability mode).
   e. Verify chunk checksum after download.
   f. If checksum fails: retry from another drive or re-upload the missing chunk.
4. Assemble chunks in order.
5. Stream the assembled file to the client.
```

### 4.2 Chunk Caching

- Frequently accessed chunks are cached in MinIO (object storage) for faster subsequent downloads.
- Cache entries have a TTL of 1 hour.
- Cache is invalidated when the source file is modified or deleted.
- Cache is not used for High Reliability mode chunks (always fetched from the primary drive).

## 5. Chunk Cleanup

- When a file is deleted, all its chunks are deleted from their respective Google Drive accounts.
- Orphaned chunks (chunks with no parent file record) are cleaned up by a scheduled job every 24 hours.
- Failed uploads older than 7 days have their chunks cleaned up.

## 6. Chunk Size Optimization (Future)

- Adaptive chunk sizing based on network conditions: smaller chunks on slow connections, larger on fast ones.
- Client-side chunk prefetching for sequential downloads.
- Deduplication of identical chunks across files (content-addressable storage).