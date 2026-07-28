# EkDrive — Download Flow

## 1. Overview

The download flow handles retrieving a file from the EkDrive virtual filesystem, fetching its chunks from the appropriate Google Drive accounts, reassembling them, and streaming the result to the user's browser.

## 2. Flow Diagram

```
┌──────────┐     ┌──────────────┐     ┌─────────────────┐     ┌──────────────┐
│  User     │────▶│  React SPA   │────▶│  API Gateway    │────▶│  File Service│
│ (clicks   │     │  (initiates  │     │  (validate JWT, │     │  (resolve    │
│  download)│     │   download)  │     │   rate limit)   │     │   file,      │
└──────────┘     └──────────────┘     └─────────────────┘     │   get chunks) │
                                                                └──────┬───────┘
                                                                       │
                                                                       ▼
                                                              ┌──────────────┐
                                                              │ Storage Engine│
                                                              │ (locate chunks│
                                                              │  across drives)│
                                                              └──────┬───────┘
                                                                       │
                                                                       ▼
                                                              ┌──────────────┐
                                                              │ Background Job │
                                                              │ (fetch chunks  │
                                                              │  from Google    │
                                                              │  Drive)         │
                                                              └──────┬───────┘
                                                                       │
                                                                       ▼
                                                              ┌──────────────┐
                                                              │ Assemble &     │
                                                              │ Verify         │
                                                              │ (checksums)    │
                                                              └──────┬───────┘
                                                                       │
                                                                       ▼
                                                              ┌──────────────┐
                                                              │ Stream to      │
                                                              │ Client         │
                                                              │ (HTTP response)│
                                                              └──────────────┘
```

## 3. Step-by-Step Walkthrough

### Step 1: Download Request (Client)

1. User clicks the download button on a file in the virtual filesystem.
2. The React SPA sends a request to the download endpoint:

```
GET /api/files/:file_id/download
Headers:
  Authorization: Bearer <jwt>
Accept: application/octet-stream
```

3. The client tracks download progress via the `Content-Length` response header and `ReadableStream` progress events.

### Step 2: Resolve File Metadata (File Service)

1. File Service authenticates the user and verifies ownership of the file.
2. File Service retrieves the file record from PostgreSQL:
   - `file_id`, `name`, `size_bytes`, `is_chunked`, `chunk_count`, `google_file_ids`, `drive_assignments`, `checksum`.
3. If the file is not chunked (`is_chunked = false`):
   - Proceed directly to Step 3 with a single chunk reference.
4. If the file is chunked (`is_chunked = true`):
   - Retrieve all chunk records from the `chunks` table, ordered by `chunk_index`.
   - Each chunk record contains: `drive_id`, `google_file_id`, `chunk_index`, `size_bytes`, `checksum`.

### Step 3: Chunk Location and Drive Readiness

1. Storage Engine maps each chunk to its target drive.
2. For each chunk, check if the target drive is online:
   - If online: proceed to fetch from that drive.
   - If offline (High Reliability mode): fetch from a redundant copy on another drive.
   - If offline (no redundant copy): return an error to the client with details about which chunks are unavailable.
3. Check rate limits for each drive to avoid exceeding Google API quotas.

### Step 4: Fetch Chunks (Background Job)

1. A download job is created for each chunk (or a single job for the entire file if chunk count is small).
2. For each chunk:
   a. Retrieve the target drive's OAuth token.
   b. Fetch the chunk from Google Drive:

```
GET https://www.googleapis.com/drive/v3/files/:google_file_id?alt=media
Authorization: Bearer <drive_access_token>
```

   c. Verify the chunk checksum after download.
   d. If checksum mismatch: retry from another drive (if redundant copy exists).
   e. If all retries fail: mark the chunk as unavailable and return a partial download or error.

### Step 5: Assemble and Verify

1. Chunks are assembled in order (chunk 0, chunk 1, ..., chunk N-1).
2. The complete file checksum is computed and compared against the stored `file_checksum`.
3. If the checksum matches: the file is valid.
4. If the checksum does not match:
   - Identify which chunks failed verification.
   - Re-fetch the failed chunks.
   - Re-verify. If still failing, return an error.

### Step 6: Stream to Client

1. The assembled file is streamed to the client as an HTTP response:

```
HTTP/1.1 200 OK
Content-Type: <mime_type>
Content-Length: <file_size_bytes>
Content-Disposition: attachment; filename="<file_name>"
X-Content-Type-Options: nosniff
```

2. The response body is a `ReadableStream` of the assembled file bytes.
3. The stream is piped directly from the chunk fetch buffers to the HTTP response, minimizing memory usage.

### Step 7: Caching

- The download response may be cached by the CDN/proxy for a short duration (configurable, default 5 minutes).
- Chunk locations are cached in Redis for subsequent downloads of the same file.
- Cache is invalidated when the file is modified or deleted.

## 4. Streaming Downloads for Large Files

For files larger than 100 MB, the download is streamed rather than buffered in memory:

1. The response uses `Transfer-Encoding: chunked`.
2. Each chunk is fetched from Google Drive and immediately written to the HTTP response as it arrives.
3. The client receives a continuous stream of data.
4. Progress is reported via the `Content-Length` header and `readable` events on the client side.

## 5. Partial Downloads and Resume

- The download endpoint supports HTTP Range requests for resumable downloads.
- The client can request specific byte ranges to resume an interrupted download.
- The server handles Range requests by fetching only the relevant chunks and serving the requested byte range.

## 6. Error Handling

| Error | HTTP Status | Action |
|---|---|---|
| File not found | 404 | Return error to client |
| User not authorized | 403 | Return error to client |
| All drives offline | 503 | Return error with drive status details |
| Chunk checksum mismatch | 500 | Retry, then return error if persistent |
| Google Drive API error | 502 | Retry with backoff, then return error |
| Insufficient quota on drive | 507 | Attempt to fetch from redundant copy; if none, return error |

## 7. Download for Chunked Files

For chunked files, the download flow must:
1. Fetch all chunks from their respective drives.
2. Reassemble them in the correct order.
3. Verify the complete file checksum.
4. Stream the assembled file to the client.

The client is unaware that the file was chunked — it receives a single, continuous file stream.