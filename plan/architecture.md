# EkDrive — System Architecture

## 1. Architectural Overview

EkDrive follows a **layered, modular architecture** with clear separation of concerns. The system is composed of the following layers:

```
┌─────────────────────────────────────────────────────────┐
│                     Client (Browser)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │  React SPA   │  │  Service     │  │  Web Workers │ │
│  │  (UI Layer)  │  │  Workers     │  │  (Chunking,  │ │
│  └──────────────┘  └──────────────┘  │   Encoding)  │ │
│                                       └──────────────┘ │
├─────────────────────────────────────────────────────────┤
│                  API Gateway / Reverse Proxy            │
│              (Nginx / Caddy / Cloudflare)               │
├─────────────────────────────────────────────────────────┤
│                   Application Server                     │
│  ┌────────────┐ ┌────────────┐ ┌────────────────────┐ │
│  │  Auth      │ │  File      │ │  Sync Engine       │ │
│  │  Service   │ │  Service   │ │                    │ │
│  └────────────┘ └────────────┘ └────────────────────┘ │
│  ┌────────────┐ ┌────────────┐ ┌────────────────────┐ │
│  │  Storage   │ │  Health    │ │  Background Jobs   │ │
│  │  Engine    │ │  Monitor   │ │  (Queue/Workers)   │ │
│  └────────────┘ └────────────┘ └────────────────────┘ │
├─────────────────────────────────────────────────────────┤
│                     Data Layer                          │
│  ┌────────────┐ ┌────────────┐ ┌────────────────────┐ │
│  │  PostgreSQL │ │  Redis     │ │  Object Storage    │ │
│  │  (Metadata) │ │  (Cache +  │ │  (Chunk blobs,     │ │
│  │             │ │   Queue)   │ │   temp files)      │ │
│  └────────────┘ └────────────┘ └────────────────────┘ │
├─────────────────────────────────────────────────────────┤
│              Google Drive API Layer                     │
│         (OAuth2 + Google Drive REST API v3)            │
└─────────────────────────────────────────────────────────┘
```

## 2. Layer Descriptions

### 2.1 Client Layer
- **React SPA**: Single-page application rendering the virtual filesystem, file operations, and settings.
- **Service Workers**: Handle background sync, caching, and offline capabilities.
- **Web Workers**: Perform client-side chunking, encoding, and checksum computation without blocking the UI thread.

### 2.2 API Gateway
- Terminates TLS, handles rate limiting, and routes requests to the application server.
- Provides a single entry point for all client communication.
- Handles CORS, request validation, and authentication token forwarding.

### 2.3 Application Server
The core backend, implemented as a set of microservices or a modular monolith (see Tech Stack).

| Service | Responsibility |
|---|---|
| **Auth Service** | Google OAuth2 flow, token management, session handling |
| **File Service** | Virtual filesystem operations (CRUD, search, metadata) |
| **Storage Engine** | Drive selection, chunk distribution, placement algorithms |
| **Sync Engine** | Change detection, conflict resolution, bidirectional sync |
| **Health Monitor** | Drive connectivity checks, quota monitoring, alerting |
| **Background Jobs** | Async task processing (uploads, downloads, sync, rebalancing) |

### 2.4 Data Layer
- **PostgreSQL**: Primary metadata store (users, files, drives, chunks, sessions).
- **Redis**: Cache for hot metadata, job queue, rate limiting counters, and session store.
- **Object Storage** (MinIO/S3-compatible): Temporary chunk storage during upload/download, and durable chunk blobs for the High Reliability mode.

### 2.5 Google Drive API Layer
- Manages OAuth2 tokens for each connected Google account.
- Translates EkDrive virtual paths into Google Drive API calls.
- Handles rate limiting per Google Drive account to avoid quota exhaustion.

## 3. Key Architectural Decisions

### 3.1 Modular Monolith vs. Microservices
**Decision**: Start with a modular monolith. Each service is a separate module with a well-defined interface, but they run in a single process.

**Rationale**: Reduces operational complexity for the initial launch. Microservices can be extracted later when individual services have distinct scaling requirements.

### 3.2 Virtual Filesystem Abstraction
**Decision**: The virtual filesystem is a logical layer that maps virtual paths to physical locations (Google Drive account + folder + chunk index).

**Rationale**: Decouples the user's mental model (one drive, one folder tree) from the physical reality (data spread across multiple Google Drive accounts). This allows the storage engine to change placement logic without affecting the user's view.

### 3.3 Chunk Storage Strategy
**Decision**: Chunks are stored as objects in MinIO/S3-compatible storage during transit, and as Google Drive files in the target accounts for durable storage.

**Rationale**: Google Drive API does not support arbitrary binary blobs natively — files must be stored as Drive files. MinIO provides a fast staging area for chunk assembly and temporary storage during chunking operations.

### 3.4 Metadata-First Design
**Decision**: All file metadata (name, size, virtual path, chunk references, drive assignments, checksums) is stored in PostgreSQL. Google Drive file IDs are stored as references, not as the source of truth.

**Rationale**: This allows EkDrive to maintain a consistent view of the virtual filesystem independent of Google Drive's internal structure. If a Google Drive account goes offline, the metadata remains intact and operations can be queued or redirected.

### 3.5 Event-Driven Sync
**Decision**: The sync engine uses an event-driven model. Changes to the virtual filesystem produce events that are consumed by the sync engine, which translates them into Google Drive API operations.

**Rationale**: Decouples the file service from the sync engine, allowing each to scale independently and recover from failures without data loss.

## 4. Data Flow Diagrams

### 4.1 Upload Flow (Simplified)

```
User selects file → Client chunks file → POST /api/upload (metadata + chunks)
  → API Gateway → File Service (create virtual file entry)
  → Storage Engine (select drives, assign chunks)
  → Background Job picks up upload task
  → Job uploads chunks to selected Google Drive accounts
  → On completion: update metadata, mark file as ready
  → Notify client via WebSocket
```

### 4.2 Download Flow (Simplified)

```
User requests file → GET /api/files/:id/download
  → API Gateway → File Service (resolve virtual path)
  → Storage Engine (locate chunks across drives)
  → Background Job fetches chunks from Google Drive accounts
  → Job assembles chunks in order
  → Stream assembled file to client
  → Cache chunk locations in Redis for subsequent requests
```

### 4.3 Health Check Flow

```
Health Monitor (cron/scheduler)
  → For each connected drive:
      → Check OAuth token validity
      → Make a lightweight Drive API call (about.get)
      → Verify quota and connectivity
      → Update drive status in PostgreSQL
      → If drive is unhealthy:
          → Trigger reconnection logic
          → If reconnection fails: mark drive as offline
          → Trigger rebalancing of affected files
          → Notify user via WebSocket/email
```

## 5. Cross-Cutting Concerns

- **Authentication**: Every request is authenticated via JWT. The token contains the user ID and is validated by the API Gateway.
- **Authorization**: Users can only access their own virtual filesystem. Multi-tenancy is enforced at the service level.
- **Rate Limiting**: Per-user and per-drive rate limits are enforced to respect Google Drive API quotas.
- **Logging**: Structured JSON logging with correlation IDs for tracing requests across services.
- **Tracing**: Distributed tracing headers propagated through all service boundaries.