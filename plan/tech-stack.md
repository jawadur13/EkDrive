# EkDrive — Technology Stack

## 1. Backend

### 1.1 Runtime & Language
| Component | Technology | Rationale |
|---|---|---|
| **Application Server** | Node.js (TypeScript) | Async I/O model is ideal for I/O-heavy operations (Drive API calls, file streaming). TypeScript provides type safety across the codebase. |
| **Runtime Version** | Node.js 22 LTS | Active LTS with best performance and security support. |
| **Package Manager** | pnpm | Fast, disk-efficient, strict dependency resolution. |

### 1.2 Framework & Libraries
| Concern | Library | Notes |
|---|---|---|
| **HTTP Server** | Hono | Lightweight, fast, TypeScript-first web framework. Supports middleware, routing, and WebSocket upgrades. Alternative: Fastify. |
| **ORM** | Prisma | Type-safe database access, migrations, and schema management. Works well with PostgreSQL. |
| **Authentication** | Passport.js (Google Strategy) + JWT | OAuth2 flow with Google, JWT for session management. |
| **Job Queue** | BullMQ (Redis-backed) | Robust job queue with retries, rate limiting, delayed jobs, and priority queues. |
| **WebSocket** | Hono WebSocket or ws | Real-time notifications for health status, sync progress, and upload completion. |
| **Validation** | Zod | Runtime type validation for API request/response schemas. |
| **File Processing** | Sharp (images), FFmpeg (video/audio), pdf-parse (PDFs) | Client-side processing via Web Workers; server-side for metadata extraction. |
| **Checksum** | xxhash (via native binding) or Node.js crypto | Fast checksum computation for chunk integrity verification. |
| **Logging** | Pino | Fast, structured JSON logging. |
| **Tracing** | OpenTelemetry | Distributed tracing for request flow across modules. |

### 1.3 Background Workers
- **BullMQ workers** run in separate Node.js processes (or threads via worker_threads).
- Each worker type handles a specific job category: upload, download, sync, health-check, rebalance.
- Workers are horizontally scalable — add more worker processes as load increases.

## 2. Frontend

| Component | Technology | Rationale |
|---|---|---|
| **Framework** | React 18+ | Component-based UI, large ecosystem, strong community. |
| **Language** | TypeScript | Type safety, better developer experience. |
| **Build Tool** | Vite | Fast HMR, optimized builds, modern ES module support. |
| **State Management** | Zustand | Lightweight, minimal boilerplate. Suitable for filesystem state, UI state, and auth state. |
| **Routing** | React Router v6 | Standard client-side routing for SPA. |
| **HTTP Client** | TanStack Query (React Query) | Server state management, caching, background refetching, optimistic updates. |
| **File Handling** | File System Access API + custom chunking in Web Workers | Native file picker, chunked uploads with progress tracking. |
| **UI Components** | Tailwind CSS + Radix UI | Utility-first CSS for rapid styling; unstyled accessible components as foundation. |
| **Icons** | Lucide React | Consistent, modern icon set. |
| **Charts/Graphs** | Recharts | Storage usage charts, drive health dashboards. |
| **Virtual Scrolling** | @tanstack/virtual | Efficient rendering of large file lists. |
| **Drag & Drop** | @dnd-kit | File and folder reordering, upload drag-and-drop. |

## 3. Database

| Layer | Technology | Rationale |
|---|---|---|
| **Primary Database** | Neon (PostgreSQL 16) | Serverless PostgreSQL, free tier (0.5GB). ACID compliance, JSONB support, excellent Prisma support. No infrastructure management. |
| **Cache & Queue** | Upstash Redis | Serverless Redis, free tier (30MB). Caching hot metadata, BullMQ job queue, rate limiting, session store. No infrastructure management. |
| **Object Storage** | None | All user file data is stored exclusively on the users' connected Google Drive accounts. EkDrive never stores user file bytes. Only metadata (chunk references, drive assignments, checksums) is stored in PostgreSQL. |

## 4. Infrastructure

| Concern | Technology | Rationale |
|---|---|---|
| **Frontend Hosting** | Vercel | Free tier for static sites and serverless functions. Global CDN, instant deployments, preview URLs. |
| **Backend Hosting** | Vercel Serverless Functions | Zero-config serverless functions. Scales automatically. Free tier includes 100GB bandwidth/month. |
| **Background Workers** | Vercel Cron Jobs + Serverless Functions | Scheduled jobs (health checks, sync, cleanup) run as serverless functions triggered by Vercel Cron. |
| **CI/CD** | GitHub Actions | Automated testing, linting, building, and deployment. Free for public repos. |
| **Monitoring** | Vercel Analytics + Sentry (free tier) | Performance monitoring and error tracking. |
| **DNS** | Cloudflare (free tier) | DNS management, CDN, and DDoS protection. |

## 5. Google Drive Integration

| Component | Details |
|---|---|
| **API** | Google Drive API v3 |
| **Auth Flow** | OAuth 2.0 (Authorization Code with PKCE) |
| **Scopes** | `https://www.googleapis.com/auth/drive.file` (per-file access) for v1; `drive` for full access if needed later |
| **Token Storage** | Encrypted at rest in Neon (PostgreSQL), encrypted in transit via TLS |
| **Rate Limiting** | Per-drive quota tracking; exponential backoff on 429 responses |
| **SDK** | Google API Node.js Client (`googleapis` package) |

## 6. Development Environment

| Tool | Purpose |
|---|---|
| **Neon** | Serverless PostgreSQL for development and testing. |
| **Upstash Redis** | Serverless Redis for caching and job queue in development. |
| **Prisma Studio** | Visual database inspection and migration management. |
| **ESLint + Prettier** | Code quality and formatting enforcement. |
| **Husky + lint-staged** | Pre-commit hooks for linting and formatting. |
| **Vitest** | Unit and integration testing framework. |
| **Playwright** | End-to-end testing for the frontend. |
| **Vercel CLI** | `vercel dev` for local backend development with serverless functions. |

## 7. Key Trade-Offs

| Decision | Trade-Off |
|---|---|
| **Modular monolith over microservices** | Simpler deployment and development, but services cannot be scaled independently yet. |
| **PostgreSQL over a NoSQL store** | Strong consistency for metadata is critical; NoSQL would add complexity for relational data. |
| **No object storage** | Eliminates infrastructure complexity and cost, but chunks are stored directly on Google Drive which has API rate limits. |
| **Vercel serverless over dedicated servers** | Zero infrastructure management, automatic scaling, but cold starts may add latency to first request. |
| **Neon/Upstash over self-hosted** | No database/Redis management, but free tiers have storage and connection limits. |
| **BullMQ over a custom scheduler** | Battle-tested, feature-rich, but adds Redis dependency. |
| **React SPA over SSR** | File operations are inherently interactive; SPA provides the best UX for real-time updates and drag-and-drop. |