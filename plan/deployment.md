# EkDrive — Deployment Strategy

## 1. Deployment Overview

EkDrive uses a **serverless-first deployment model** on the Vercel platform for both frontend and backend, with Neon for PostgreSQL and Upstash for Redis. The deployment strategy emphasizes zero infrastructure management, automatic scaling, and free-tier cost.

## 2. Environment Strategy

| Environment | Platform | Purpose |
|---|---|---|
| **Local** | Development | `pnpm dev` starts frontend (Vite) and backend (Hono) locally |
| **Staging** | Vercel Preview Deployments | Auto-created from PRs; isolated testing |
| **Production** | Vercel Production Deployments | Live users on `app.ekdrive.io` |

## 3. Frontend Deployment (Vercel)

### 3.1 Configuration

```yaml
# vercel.json
{
  "buildCommand": "pnpm build",
  "devCommand": "pnpm dev",
  "installCommand": "pnpm install",
  "framework": "vite",
  "outputDirectory": "dist"
}
```

### 3.2 Environment Variables (Vercel)

| Variable | Description |
|---|---|
| `VITE_API_URL` | Backend API URL (e.g., `https://api.ekdrive.io`) |
| `VITE_WS_URL` | WebSocket URL for real-time updates |

### 3.3 Deployment

- Every push to `main` triggers a production deployment.
- Every PR triggers a preview deployment.
- Deployments are instant with global CDN distribution.

## 4. Backend Deployment (Vercel Serverless Functions)

### 4.1 Configuration

The backend is deployed as Vercel Serverless Functions:

```
vercel.json
{
  "build": {
    "env": {
      "NEXT_RUNTIME": "nodejs"
    }
  },
  "functions": {
    "api/**/*.ts": {
      "maxDuration": 30
    }
  }
}
```

### 4.2 Environment Variables (Vercel)

| Variable | Description |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `REDIS_URL` | Upstash Redis connection string |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `JWT_SECRET` | Secret for signing JWTs |
| `ENCRYPTION_KEY` | Key for encrypting OAuth tokens |
| `CORS_ORIGIN` | Allowed CORS origins |
| `RATE_LIMIT_MAX` | Max requests per minute per user |
| `CHUNK_SIZE_BYTES` | Default chunk size (52428800) |

### 4.3 Scheduled Functions (Background Jobs)

Vercel Cron Jobs replace the need for dedicated background worker processes:

```json
{
  "crons": [
    { "path": "/api/cron/health-check", "schedule": "*/1 * * * *" },
    { "path": "/api/cron/sync", "schedule": "*/30 * * * *" },
    { "path": "/api/cron/cleanup", "schedule": "0 2 * * *" },
    { "path": "/api/cron/token-refresh", "schedule": "*/5 * * * *" }
  ]
}
```

## 5. Database Deployment (Neon)

### 5.1 Setup

1. Create a Neon project at https://neon.tech.
2. Create a PostgreSQL database (free tier: 0.5GB storage).
3. Copy the connection string.
4. Run Prisma migrations: `pnpm prisma migrate deploy`.
5. Store the connection string in Vercel environment variables.

### 5.2 Branching

Neon supports database branching (similar to Git branching):
- Each PR can have its own database branch for integration testing.
- Production database is never affected by testing.

## 6. Redis Deployment (Upstash)

### 6.1 Setup

1. Create an Upstash Redis database at https://upstash.com.
2. Copy the REST URL and token.
3. Store in Vercel environment variables.

### 6.2 Usage

- Upstash Redis is serverless — connections are HTTP-based, not TCP.
- This works well with Vercel Serverless Functions which are stateless.
- BullMQ is compatible with Upstash Redis via the REST API.

## 7. CI/CD Pipeline

### 7.1 GitHub Actions Workflow

```yaml
name: CI/CD

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm lint
      - run: pnpm format:check

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm typecheck

  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: test
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
        ports:
          - 5432:5432
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm test:coverage

  deploy-staging:
    needs: [lint, typecheck, test]
    if: github.ref == 'refs/heads/develop'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm build
      - uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--preview'

  deploy-production:
    needs: [lint, typecheck, test]
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm build
      - uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--prod'
```

## 8. Rollback

- Vercel keeps all deployment history.
- Any previous deployment can be promoted to production with one click.
- Git revert + push triggers an automatic rollback deployment.
- Database migrations are backward-compatible (no destructive changes in a single deployment).

## 9. Monitoring and Observability

| Concern | Tool |
|---|---|
| **Logs** | Vercel Analytics + Sentry (free tier) |
| **Error Tracking** | Sentry (free tier: 5,000 events/month) |
| **Performance** | Vercel Analytics (Core Web Vitals) |
| **Uptime** | UptimeRobot (free tier: 50 monitors) |
| **Alerting** | Sentry alerts → email |

### Key Metrics

| Metric | Alert Threshold |
|---|---|
| API error rate | > 1% of requests |
| API latency (p99) | > 1000ms |
| Upload job failure rate | > 5% |
| Drive offline count | > 0 (notify immediately) |
| Neon storage usage | > 80% of free tier (500MB) |
| Upstash storage usage | > 80% of free tier (30MB) |
| Vercel bandwidth | > 80% of free tier (100GB/month) |