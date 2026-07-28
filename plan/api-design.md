# EkDrive — API Design

## 1. Design Principles

- **RESTful**: Resources are represented as nouns; operations are HTTP methods.
- **JSON**: All request and response bodies are JSON.
- **Versioned**: API version is in the URL path (`/api/v1/...`).
- **Paginated**: List endpoints use cursor-based pagination.
- **Authenticated**: All endpoints require a valid JWT in the `Authorization` header or cookie.
- **Idempotent**: Safe operations (GET, PUT) are idempotent; POST operations use idempotency keys for critical actions.

## 2. Base URL

```
https://api.ekdrive.io/api/v1
```

## 3. Authentication

### 3.1 Request

```
Authorization: Bearer <jwt>
```

The JWT is also sent as an httpOnly cookie for browser-based requests.

### 3.2 Response (Unauthorized)

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required.",
    "details": null
  }
}
```

## 4. Endpoints

### 4.1 Auth

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/auth/login` | Initiate Google OAuth flow (redirects to Google consent screen) |
| `GET` | `/auth/callback` | OAuth callback; exchanges code for tokens |
| `POST` | `/auth/logout` | Revokes session and clears cookies |
| `GET` | `/auth/me` | Returns current user profile |
| `POST` | `/auth/refresh` | Refresh access token using refresh token |

### 4.2 Drives

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/drives` | List all connected drives for the user |
| `POST` | `/drives` | Connect a new Google Drive account |
| `GET` | `/drives/:drive_id` | Get details for a specific drive |
| `DELETE` | `/drives/:drive_id` | Disconnect a drive |
| `GET` | `/drives/:drive_id/health` | Get health status for a drive |

### 4.3 Files

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/files` | List files and folders (with pagination) |
| `GET` | `/files/:file_id` | Get file metadata |
| `POST` | `/files` | Create a folder or upload a file |
| `PATCH` | `/files/:file_id` | Rename or move a file/folder |
| `DELETE` | `/files/:file_id` | Delete a file or folder |
| `GET` | `/files/:file_id/download` | Download a file |
| `GET` | `/files/:file_id/preview` | Stream a preview of a file |
| `GET` | `/files/:file_id/thumbnail` | Get a thumbnail for a file |
| `GET` | `/files/search` | Search files by name or content |
| `POST` | `/files/:file_id/share` | Create a share link for a file |
| `GET` | `/files/:file_id/stats` | Get storage statistics for a file |

### 4.4 Storage Mode

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/storage-mode` | Get the user's active storage mode |
| `PUT` | `/storage-mode` | Update the user's storage mode |
| `GET` | `/storage-mode/rebalance` | Trigger a manual rebalance |

### 4.5 Sync

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/sync/status` | Get sync status for all drives |
| `POST` | `/sync/trigger` | Trigger an immediate sync |
| `GET` | `/sync/conflicts` | List unresolved conflicts |
| `POST` | `/sync/conflicts/:conflict_id/resolve` | Resolve a conflict |

### 4.6 Sharing

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/shares` | List all share links for the user |
| `POST` | `/shares` | Create a share link |
| `GET` | `/shares/:token` | Access a shared file (no auth required) |
| `DELETE` | `/shares/:share_id` | Revoke a share link |

### 4.7 Health

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | System health check (load balancer probe) |
| `GET` | `/health/drives` | Health status of all connected drives for the user |

## 5. Request/Response Examples

### 5.1 List Files

```
GET /api/v1/files?parent_id=folder-uuid-xyz&page=cursor123&limit=50
```

Response:
```json
{
  "data": [
    {
      "id": "file-uuid-1",
      "name": "report.pdf",
      "virtual_path": "/Documents/report.pdf",
      "is_folder": false,
      "mime_type": "application/pdf",
      "size_bytes": 1048576,
      "checksum": "sha256:abc123...",
      "created_at": "2026-07-29T03:00:00Z",
      "updated_at": "2026-07-29T03:00:00Z"
    }
  ],
  "pagination": {
    "next_cursor": "cursor456",
    "has_more": true,
    "total_count": 150
  }
}
```

### 5.2 Upload Initiation

```
POST /api/v1/files/upload/init
Content-Type: application/json

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

Response:
```json
{
  "file_id": "file-uuid-abc",
  "placement": [
    { "chunk_index": 0, "drive_id": "drive-uuid-1", "chunk_size": 52428800 },
    { "chunk_index": 1, "drive_id": "drive-uuid-2", "chunk_size": 52428800 },
    { "chunk_index": 2, "drive_id": "drive-uuid-1", "chunk_size": 52428800 }
  ],
  "upload_url": "/api/v1/files/upload/chunk"
}
```

### 5.3 Storage Mode Update

```
PUT /api/v1/storage-mode
Content-Type: application/json

{
  "mode": "high_reliability",
  "min_replicas": 2
}
```

Response:
```json
{
  "mode": "high_reliability",
  "min_replicas": 2,
  "rebalance_threshold": 0.15,
  "effective_capacity_gb": 150.5
}
```

## 6. Error Format

All error responses follow a consistent format:

```json
{
  "error": {
    "code": "INSUFFICIENT_STORAGE",
    "message": "Not enough storage space available across connected drives.",
    "details": {
      "required_bytes": 1073741824,
      "available_bytes": 536870912,
      "drive_ids": ["drive-uuid-1", "drive-uuid-2"]
    }
  }
}
```

### 6.1 Error Codes

| Code | HTTP Status | Description |
|---|---|---|
| `UNAUTHORIZED` | 401 | Authentication required or invalid token |
| `FORBIDDEN` | 403 | User does not have permission |
| `NOT_FOUND` | 404 | Resource not found |
| `VALIDATION_ERROR` | 422 | Request body validation failed |
| `INSUFFICIENT_STORAGE` | 422 | Not enough storage space |
| `RATE_LIMITED` | 429 | Too many requests |
| `DRIVE_OFFLINE` | 503 | Target drive is offline |
| `DRIVE_QUOTA_EXCEEDED` | 507 | Target drive has no available space |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

## 7. WebSocket Events

| Event | Direction | Payload |
|---|---|---|
| `upload_progress` | Server → Client | `{ file_id, chunk_index, progress: 0-100 }` |
| `upload_complete` | Server → Client | `{ file_id, status: 'ready', virtual_path }` |
| `download_progress` | Server → Client | `{ file_id, bytes_downloaded, total_bytes }` |
| `drive_status_change` | Server → Client | `{ drive_id, status: 'online' | 'offline', ... }` |
| `sync_complete` | Server → Client | `{ drive_id, changes_count }` |
| `conflict_detected` | Server → Client | `{ file_id, conflict_id }` |
| `notification` | Server → Client | `{ type, message, timestamp }` |

## 8. Pagination

Cursor-based pagination for all list endpoints:

```
GET /api/v1/files?cursor=last_seen_id&limit=50
```

Response includes `next_cursor` and `has_more` fields. Cursors are opaque and should not be interpreted by the client.