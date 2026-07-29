# EkDrive — Preview & Streaming

## 1. Purpose

The Preview & Streaming system enables users to view file contents directly in the browser without downloading the entire file. It supports images, PDFs, text files, audio, and video, with progressive rendering for large files.

## 2. Supported File Types

| Category | MIME Types | Preview Method |
|---|---|---|
| **Images** | `image/*` | Direct browser rendering via `<img>` or `<canvas>` |
| **PDFs** | `application/pdf` | PDF.js rendering in a viewer component |
| **Text** | `text/*`, `application/json`, `application/xml`, `text/markdown` | Syntax-highlighted text viewer |
| **Video** | `video/*` | HTML5 `<video>` with streaming support |
| **Audio** | `audio/*` | HTML5 `<audio>` with streaming support |
| **Code** | `text/x-javascript`, `text/x-python`, `text/x-c`, etc. | Syntax-highlighted code viewer |
| **Unsupported** | All others | Download-only; no preview |

## 3. Preview Architecture

### 3.1 Client-Side Rendering

For supported file types, the client renders the preview directly in the browser:

```
User clicks file → File Service checks MIME type → If previewable:
  → Return preview URL (streaming endpoint)
  → Client renders using appropriate viewer component
  → If not previewable: show file info + download button
```

### 3.2 Streaming Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/files/:id/preview` | GET | Returns a streaming response for previewable files |
| `/api/files/:id/thumbnail` | GET | Returns a generated thumbnail (images, PDFs, videos) |
| `/api/files/:id/stream` | GET | Returns a full streaming response for download |

### 3.3 Streaming Protocol

The preview endpoint uses HTTP Range requests to support seeking and progressive loading:

```
GET /api/files/:id/preview
Range: bytes=0-1048576
Accept: video/mp4
```

The server:
1. Determines the file's chunk locations.
2. Fetches only the requested byte range from the appropriate Google Drive account(s).
3. Returns the partial content with `206 Partial Content` and appropriate `Content-Range` headers.

## 4. Preview Generation Pipeline

### 4.1 Image Previews

- Images are streamed directly from Google Drive to the browser.
- For large images, the server can generate a thumbnail on first access and cache it in Redis.
- Thumbnails are generated at multiple resolutions (128px, 256px, 512px) for responsive display.

### 4.2 PDF Previews

- PDF files are streamed to the browser.
- The client uses PDF.js to render pages in a scrollable viewer.
- The first page is prefetched for instant preview.
- PDF.js renders each page as a canvas element.

### 4.3 Video Previews

- Video files are streamed using HTML5 `<video>` with adaptive bitrate.
- The server generates a thumbnail (keyframe) at the start of the video for the file list preview.
- For large videos, the server supports byte-range requests so the browser can seek without downloading the entire file.
- Thumbnail generation is done asynchronously via a background job.

### 4.4 Audio Previews

- Audio files are streamed using HTML5 `<audio>`.
- A waveform visualization can be generated from the audio metadata.
- The first few seconds are prefetched for instant playback.

### 4.5 Text Previews

- Text files are streamed and rendered in a code viewer with syntax highlighting.
- Only the first 1 MB is streamed for preview; larger files show a "Download to view" message.
- Markdown files are rendered with a Markdown renderer.
- JSON files are formatted with collapsible tree views.

## 5. Thumbnail Generation

### 5.1 When Thumbnails Are Generated

- On first preview access for images and videos.
- On file upload (async job for images and videos).

### 5.2 Thumbnail Storage

- Thumbnails are stored in Redis cache.
- Thumbnail metadata is stored in PostgreSQL (`files.thumbnail_url`).
- Thumbnails are cached in Redis with a TTL of 24 hours.

### 5.3 Thumbnail Generation Jobs

1. A background job picks up the thumbnail generation task.
2. The job fetches the first chunk of the file from Google Drive.
3. For images: resize to the target thumbnail dimensions.
4. For videos: extract the first keyframe using FFmpeg.
5. For PDFs: render the first page using PDF.js or a server-side PDF renderer.
6. Store the thumbnail in Redis cache.
7. Update the file record with the thumbnail URL.

## 6. Streaming for Large Files

| File Size | Strategy |
|---|---|
| < 1 MB | Stream entire file in one request |
| 1 MB – 100 MB | Stream with progress tracking |
| 100 MB – 1 GB | Stream with byte-range support and chunked transfer |
| > 1 GB | Stream with adaptive chunk fetching; show progress per chunk |

## 7. Caching Strategy

| Resource | Cache Location | TTL |
|---|---|---|
| Thumbnails | Redis | 24 hours |
| Preview metadata | Redis | 1 hour |
| Chunk locations | Redis | 5 minutes |
| Streamed content | CDN (edge cache) | 5 minutes |

## 8. Security Considerations

- Preview endpoints enforce the same authorization checks as download endpoints.
- Users can only preview files they own or have access to.
- Share link previews respect the share link permissions (view-only).
- Content-Type headers are set correctly to prevent MIME sniffing attacks.
- The `X-Content-Type-Options: nosniff` header is set on all preview responses.