# EkDrive

A virtual cloud storage platform that unifies multiple Google Drive accounts into a single, intelligent storage pool. Users interact with one logical drive while EkDrive transparently manages storage allocation, file placement, chunking, redundancy, health monitoring, and synchronization across all connected Google accounts.

## Status

**Phase: Planning** — The project is currently in the planning and documentation phase. No code has been written yet. The implementation roadmap is documented in the [`/plan`](./plan) directory.

## What EkDrive Does

- **Unified Storage Pool** — Aggregate total capacity and usage across multiple connected Google Drive accounts.
- **Smart File Placement** — Automatically place files on the optimal drive based on the active storage mode.
- **File Chunking** — Split files larger than any individual drive's free space across multiple drives transparently.
- **Three Storage Modes** — Maximum Capacity, Balanced, and High Reliability (redundant copies across drives).
- **Virtual Filesystem** — A clean, independent filesystem that abstracts away Google Drive's folder structure.
- **Preview & Streaming** — In-browser previews for images, PDFs, video, audio, and text files.
- **Health Monitoring** — Continuous monitoring of drive connectivity, quota, and performance with automatic reconnection.
- **Synchronization** — Bidirectional sync between the virtual filesystem and Google Drive accounts with conflict resolution.

## Project Structure

```
EkDrive/
├── README.md
└── plan/
    ├── vision.md              — Project vision, goals, and success metrics
    ├── architecture.md         — System architecture and data flow diagrams
    ├── tech-stack.md           — Technology choices with rationale
    ├── database-schema.md      — PostgreSQL schema (9 tables)
    ├── authentication.md       — Google OAuth 2.0 flow, token management, session security
    ├── storage-engine.md       — Drive selection algorithms for all 3 modes
    ├── chunking-system.md      — File chunking, integrity verification, resumable uploads
    ├── upload-flow.md          — Complete upload workflow
    ├── download-flow.md        — Complete download workflow with reassembly
    ├── preview-streaming.md    — Preview system for images, PDFs, video, audio, text
    ├── storage-modes.md        — Detailed mode definitions and trade-offs
    ├── sync-engine.md          — Bidirectional sync and conflict resolution
    ├── drive-health.md         — Health monitoring, reconnection, alerting
    ├── background-jobs.md      — BullMQ job definitions for all worker types
    ├── security.md             — Auth security, encryption, API security, compliance
    ├── api-design.md           — RESTful API endpoints, WebSocket events, error format
    ├── frontend-architecture.md — React SPA structure, state management, routing
    ├── ui-ux.md                — Design system, screen mockups, interaction patterns
    ├── development-phases.md   — 5-phase plan over 26 weeks
    ├── testing-strategy.md     — Test pyramid, coverage gates, performance testing
    ├── deployment.md           — Docker, CI/CD, blue-green deployment, monitoring
    └── future-features.md      — v1.1 through v2.1+ roadmap
```

## Implementation Roadmap

| Phase | Timeline | Focus |
|---|---|---|
| **Phase 1: Foundation** | Weeks 1–6 | Dev environment, CI/CD, Google OAuth, database schema, API skeleton |
| **Phase 2: Core Storage** | Weeks 7–12 | Virtual filesystem, storage engine, chunking, upload/download, Google Drive integration |
| **Phase 3: Advanced Features** | Weeks 13–18 | Sync engine, background jobs, storage mode switching, rebalancing, sharing, search |
| **Phase 4: Polish & QA** | Weeks 19–22 | Testing, performance optimization, accessibility, security audit |
| **Phase 5: Launch & Monitor** | Weeks 23–26 | Production deployment, soft launch, monitoring, feedback iteration |

## Tech Stack (Planned)

| Layer | Technology |
|---|---|
| **Backend** | Node.js 22 (TypeScript), Hono framework |
| **Frontend** | React 18, TypeScript, Vite, Zustand, TanStack Query |
| **Database** | PostgreSQL 16, Prisma ORM |
| **Cache & Queue** | Redis 7, BullMQ |
| **Object Storage** | MinIO (S3-compatible) |
| **Auth** | Google OAuth 2.0 (Authorization Code with PKCE), JWT |
| **Infrastructure** | Docker, Docker Compose, ECS/Fargate |
| **Monitoring** | Prometheus, Grafana, Loki, Sentry |

## Getting Started (Development)

> This project is in the planning phase. Development setup instructions will be added in Phase 1.

```bash
# Clone the repository
git clone https://github.com/jawadur13/EkDrive.git
cd EkDrive

# Start local infrastructure
docker compose up -d

# Install dependencies
pnpm install

# Run development server
pnpm dev
```

## License

TBD