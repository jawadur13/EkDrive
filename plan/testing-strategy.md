# EkDrive — Testing Strategy

## 1. Testing Philosophy

EkDrive follows a test pyramid approach:
- **Unit tests** form the base (fast, isolated, numerous).
- **Integration tests** form the middle (test service boundaries and database interactions).
- **End-to-end tests** form the top (test critical user workflows in a browser).

Target coverage:
- **80%+ line coverage** for backend services.
- **70%+ line coverage** for frontend components.
- **100% coverage** for critical paths (auth, upload, download, storage engine, chunking).

## 2. Test Layers

### 2.1 Unit Tests

| Layer | Framework | Scope |
|---|---|---|
| **Backend** | Vitest | Service logic, storage engine algorithms, chunking logic, sync conflict resolution |
| **Frontend** | Vitest + Testing Library | React components, hooks, Zustand stores, utility functions |
| **Shared** | Vitest | Validation schemas, path utilities, formatting functions |

**Example test areas**:
- Storage Engine: Verify correct drive selection for each mode with various drive configurations.
- Chunking System: Verify chunk splitting, checksum computation, and reassembly.
- Auth Service: Token validation, refresh logic, session management.
- File Service: Path resolution, virtual path generation, permission checks.

### 2.2 Integration Tests

| Layer | Framework | Scope |
|---|---|---|
| **API Integration** | Vitest + Supertest | HTTP endpoints with mocked database |
| **Database** | Prisma + Testcontainers | Real PostgreSQL instance in Docker for migration and query tests |
| **Google Drive API** | Nock / MSW | Mock Google Drive API responses for upload/download tests |
| **BullMQ Jobs** | BullMQ + Vitest | Job processing, retries, and dead letter handling |

**Example test areas**:
- Upload endpoint: Full flow from request to chunk creation to database update.
- Download endpoint: Chunk fetching, reassembly, and checksum verification.
- Health check: Drive status transitions and alerting logic.
- Sync engine: Change detection, conflict creation, and resolution.

### 2.3 End-to-End Tests

| Layer | Framework | Scope |
|---|---|---|
| **E2E** | Playwright | Critical user workflows in a real browser |

**Example test scenarios**:
1. User logs in → connects 2 Google Drive accounts → uploads a file → verifies it appears in the file list → downloads it → verifies checksum.
2. User uploads a large file (>100 MB) → verifies chunking and progress tracking → verifies download with reassembly.
3. User changes storage mode to High Reliability → verifies rebalancing → verifies redundancy.
4. User disconnects a drive → verifies health alert → verifies files are accessible from other drives.
5. User creates a share link → verifies link works → verifies link expiry.

## 3. Test Data Management

### 3.1 Fixtures
- JSON fixtures for API request/response payloads.
- SQL fixtures for database seed data in integration tests.
- Mock Google Drive API responses for offline testing.

### 3.2 Test Isolation
- Each test suite runs in a transaction that is rolled back after the test.
- Integration tests use a dedicated test database (separate from dev/production).
- E2E tests use a staging environment with isolated data.

### 3.3 Factory Pattern
- Use factory functions to create test data (users, drives, files, chunks).
- Factories ensure consistent, valid test data across all test layers.

## 4. Test Execution

### 4.1 Local Development
```bash
# Run all unit tests
pnpm test:unit

# Run integration tests
pnpm test:integration

# Run E2E tests
pnpm test:e2e

# Run all tests with coverage
pnpm test:coverage
```

### 4.2 CI Pipeline
```yaml
# GitHub Actions workflow
- name: Run unit tests
  run: pnpm test:unit -- --coverage

- name: Run integration tests
  run: pnpm test:integration

- name: Run E2E tests
  run: pnpm test:e2e
  env:
    DATABASE_URL: ${{ secrets.TEST_DATABASE_URL }}
    REDIS_URL: ${{ secrets.TEST_REDIS_URL }}
```

### 4.3 Pre-commit Hooks
- `lint-staged` runs Vitest on changed files before committing.
- `eslint` and `prettier` run on all changed files.
- Type checking (`tsc --noEmit`) runs on all TypeScript files.

## 5. Test Coverage Gates

| Metric | Threshold | Enforcement |
|---|---|---|
| **Line coverage (backend)** | 80% | CI fails if below threshold |
| **Line coverage (frontend)** | 70% | CI fails if below threshold |
| **Branch coverage** | 70% | CI fails if below threshold |
| **Critical path coverage** | 100% | Manual review required if not met |
| **E2E critical workflows** | All passing | CI fails if any E2E test fails |

## 6. Performance Testing

| Test Type | Tool | Frequency |
|---|---|---|
| **Load testing** | k6 or Artillery | Before each release |
| **Stress testing** | k6 | Quarterly |
| **Benchmarking** | Custom scripts | After storage engine changes |

**Key performance targets**:
- Upload throughput: 50 MB/s per concurrent upload.
- Download throughput: 100 MB/s per concurrent download.
- API response time: < 200ms for standard operations.
- Chunk upload latency: < 5 seconds per 50 MB chunk.
- Health check latency: < 2 seconds per drive.

## 7. Test Environment

| Environment | Purpose | Database | External Services |
|---|---|---|---|
| **Local** | Developer testing | Docker Compose PostgreSQL | Mocked Google Drive API |
| **Staging** | Integration and E2E testing | Dedicated staging PostgreSQL | Sandbox Google Drive API |
| **Production** | Monitoring and canary testing | Production PostgreSQL | Production Google Drive API |