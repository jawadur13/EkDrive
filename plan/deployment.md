# EkDrive — Deployment Strategy

## 1. Deployment Overview

EkDrive uses a containerized deployment model with Docker and Docker Compose for local development, and Kubernetes (or ECS) for production. The deployment strategy emphasizes zero-downtime releases, automated rollbacks, and environment parity.

## 2. Environment Strategy

| Environment | Purpose | URL | Data |
|---|---|---|---|
| **Local** | Development | `localhost:3000` | Docker Compose (PostgreSQL, Redis, MinIO) |
| **Staging** | Integration testing, QA | `staging.ekdrive.io` | Isolated staging database; sandbox Google Drive API |
| **Production** | Live users | `app.ekdrive.io` | Production database; production Google Drive API |

## 3. Containerization

### 3.1 Dockerfile (Backend)

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine AS production
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### 3.2 Dockerfile (Frontend)

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM caddy:2-alpine AS production
COPY --from=builder /app/dist /usr/share/caddy/html
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443
```

### 3.3 Docker Compose (Development)

```yaml
version: '3.8'
services:
  app:
    build: ./backend
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/ekdrive
      - REDIS_URL=redis://redis:6379
      - MINIO_URL=http://minio:9000
    depends_on:
      - db
      - redis
      - minio

  frontend:
    build: ./frontend
    ports:
      - "5173:5173"
    environment:
      - VITE_API_URL=http://localhost:3000

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ekdrive
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    volumes:
      - redisdata:/data

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minio
      MINIO_ROOT_PASSWORD: minio123
    volumes:
      - miniodata:/data

volumes:
  pgdata:
  redisdata:
  miniodata:
```

## 4. Production Infrastructure

### 4.1 Compute

| Component | AWS Service | Alternative |
|---|---|---|
| **Application** | ECS Fargate or EKS (Kubernetes) | Google Cloud Run, Azure Container Apps |
| **Background Workers** | ECS Fargate tasks (separate service) | Kubernetes Jobs |
| **Auto Scaling** | Target tracking on CPU/memory | HPA on Kubernetes |

### 4.2 Data

| Component | AWS Service | Alternative |
|---|---|---|
| **PostgreSQL** | RDS PostgreSQL 16 (Multi-AZ) | Cloud SQL (GCP), Azure Database for PostgreSQL |
| **Redis** | ElastiCache Redis 7 (Cluster mode) | Memorystore (GCP), Azure Cache for Redis |
| **Object Storage** | S3 (MinIO for self-hosted) | Google Cloud Storage, Azure Blob Storage |
| **CDN** | CloudFront | Cloudflare, Fastly |

### 4.3 Networking

| Component | AWS Service | Alternative |
|---|---|---|
| **Load Balancer** | ALB (Application Load Balancer) | Cloud Load Balancer (GCP) |
| **DNS** | Route 53 | Cloud DNS, Cloudflare |
| **WAF** | AWS WAF | Cloudflare WAF |
| **TLS Termination** | ALB with ACM certificate | Caddy with Let's Encrypt |

## 5. CI/CD Pipeline

### 5.1 GitHub Actions Workflow

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
      minio:
        image: minio/minio:latest
        args: server /data --console-address ":9001"
        env:
          MINIO_ROOT_USER: minio
          MINIO_ROOT_PASSWORD: minio123
        ports:
          - 9000:9000
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm test:coverage

  build:
    needs: [lint, typecheck, test]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm build
      - uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ekdrive:${{ github.sha }}

  deploy-staging:
    needs: build
    if: github.ref == 'refs/heads/develop'
    runs-on: ubuntu-latest
    steps:
      - uses: aws-actions/amazon-ecs-deploy-task-definition@v1
        with:
          task-definition: ekdrive-staging
          service: ekdrive-staging
          cluster: ekdrive-cluster

  deploy-production:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: aws-actions/amazon-ecs-deploy-task-definition@v1
        with:
          task-definition: ekdrive-production
          service: ekdrive-production
          cluster: ekdrive-cluster
```

## 6. Deployment Strategy

### 6.1 Blue-Green Deployment

- Two identical environments (blue and green) run in production.
- New versions are deployed to the inactive environment.
- Traffic is switched to the new environment after health checks pass.
- The old environment is kept running for quick rollback.

### 6.2 Health Checks

| Check | Endpoint | Frequency | Success Criteria |
|---|---|---|---|
| **Liveness** | `GET /health` | Every 10 seconds | HTTP 200 |
| **Readiness** | `GET /health/ready` | Every 5 seconds | HTTP 200, database connected, Redis connected |
| **Startup** | `GET /health/started` | Every 30 seconds | HTTP 200, all migrations applied |

### 6.3 Rollback

- If a deployment fails health checks, traffic is automatically routed back to the previous version.
- Manual rollback is supported via the deployment pipeline (revert commit + redeploy).
- Database migrations are backward-compatible (no destructive changes in a single deployment).

## 7. Environment Variables

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/ekdrive` |
| `REDIS_URL` | Redis connection string | `redis://host:6379` |
| `MINIO_URL` | MinIO endpoint | `http://minio:9000` |
| `MINIO_ACCESS_KEY` | MinIO access key | `minio` |
| `MINIO_SECRET_KEY` | MinIO secret key | `minio123` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | `123456789.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | `GOCSPX-...` |
| `JWT_SECRET` | Secret for signing JWTs | `random-256-bit-string` |
| `ENCRYPTION_KEY` | Key for encrypting OAuth tokens | `random-256-bit-string` |
| `CORS_ORIGIN` | Allowed CORS origins | `https://app.ekdrive.io` |
| `RATE_LIMIT_MAX` | Max requests per minute per user | `100` |
| `CHUNK_SIZE_BYTES` | Default chunk size | `52428800` |

## 8. Monitoring and Observability

| Concern | Tool |
|---|---|
| **Metrics** | Prometheus + Grafana |
| **Logs** | Loki + Grafana (or ELK stack) |
| **Tracing** | OpenTelemetry + Jaeger |
| **Error Tracking** | Sentry |
| **Alerting** | Grafana Alerts → PagerDuty |
| **Uptime** | UptimeRobot or CloudWatch Synthetic Canaries |

### Key Metrics

| Metric | Alert Threshold |
|---|---|
| API error rate | > 1% of requests |
| API latency (p99) | > 1000ms |
| Upload job failure rate | > 5% |
| Drive offline count | > 0 (notify immediately) |
| Database connection pool | > 80% utilized |
| Redis memory usage | > 80% utilized |
| Disk usage (MinIO) | > 85% utilized |