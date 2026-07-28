# EkDrive — Drive Health Monitoring

## 1. Purpose

The Drive Health Monitor continuously checks the connectivity, quota status, and overall health of each connected Google Drive account. It ensures that the system can detect and respond to drive failures, quota issues, and performance degradation.

## 2. Health Check Types

### 2.1 Connectivity Check

| Check | Method | Frequency |
|---|---|---|
| **Token validity** | Attempt a lightweight Drive API call (`about.get`) | Every 60 seconds |
| **Network latency** | Measure round-trip time of the health check request | Every 60 seconds |
| **API quota remaining** | Read `X-RateLimit-Remaining` headers from Drive API responses | Every 60 seconds |

### 2.2 Quota Check

| Check | Method | Frequency |
|---|---|---|
| **Available space** | `about.get` returns `storageQuota.usage` and `storageQuota.limit` | Every 5 minutes |
| **Utilization percentage** | Computed as `usage / limit * 100` | Every 5 minutes |
| **Low space warning** | Triggered when available space < 10% of total quota | Every 5 minutes |

### 2.3 File Integrity Check

| Check | Method | Frequency |
|---|---|---|
| **Random chunk verification** | Fetch a random chunk and verify its checksum | Every 1 hour |
| **Full file verification** | Verify checksums of a random sample of files | Every 24 hours |

## 3. Health Statuses

| Status | Description | Action Required |
|---|---|---|
| `healthy` | Drive is online, has sufficient quota, and passes integrity checks. | None. |
| `degraded` | Drive has low quota (<10%) or high latency. | User notification; consider rebalancing. |
| `offline` | Drive is unreachable or OAuth token is invalid. | Automatic reconnection attempt; user notification. |
| `quota_exceeded` | Drive has no available space. | User notification; files cannot be placed on this drive. |
| `reconnecting` | The system is attempting to restore connectivity. | Wait for reconnection to complete. |

## 4. Health Check Flow

```
Health Monitor (scheduled job)
  │
  ├── For each drive belonging to the user:
  │     │
  │     ├── 1. Check OAuth token validity
  │     │     ├── Valid: proceed
  │     │     ├── Expired: attempt refresh
  │     │     └── Refresh failed: mark as offline, notify user
  │     │
  │     ├── 2. Make lightweight API call (about.get)
  │     │     ├── Success: proceed
  │     │     ├── 401/403: token invalid, attempt refresh
  │     │     ├── 429: rate limited, back off
  │     │     └── Network error: mark as offline, attempt reconnection
  │     │
  │     ├── 3. Read quota information
  │     │     ├── Update drive.available_quota_bytes
  │     │     ├── Update drive.status based on quota
  │     │     └── If quota_exceeded: mark drive as quota_exceeded
  │     │
  │     ├── 4. Record health check result
  │     │     ├── Create health_checks record
  │     │     └── Update drive.last_health_check and drive.status
  │     │
  │     └── 5. If status changed:
  │           ├── online → offline: trigger reconnection, rebalance affected files
  │           ├── offline → online: trigger rebalance, notify user
  │           ├── healthy → degraded: notify user
  │           └── degraded → healthy: notify user
  │
  └── If any drive is offline for > 5 minutes:
        └── Send email notification to user
```

## 5. Reconnection Logic

### 5.1 Automatic Reconnection

When a drive goes offline:

1. The Health Monitor attempts to refresh the OAuth token.
2. If refresh succeeds:
   - Update the stored token.
   - Mark the drive as `reconnecting`.
   - Run a lightweight API call to verify connectivity.
   - If successful: mark as `healthy`.
3. If refresh fails:
   - Keep the drive as `offline`.
   - Retry token refresh every 5 minutes.
   - After 3 failed retries, notify the user to re-authenticate.

### 5.2 User-Initiated Reconnection

Users can manually reconnect a drive from the UI:
1. Go to Settings → Connected Drives.
2. Click "Reconnect" on the offline drive.
3. The OAuth flow is re-initiated.
4. On success, the drive status is updated and rebalancing begins.

## 6. Health History

Health check results are stored in the `health_checks` table:

| Column | Purpose |
|---|---|
| `status` | The health status at the time of the check |
| `latency_ms` | Response latency |
| `quota_available` | Available quota at the time |
| `error_message` | Error details if the check failed |

### Retention Policy

- Health check records are retained for 90 days.
- Aggregated daily summaries (average latency, uptime percentage, quota trends) are kept for 1 year.
- Older records are purged by a scheduled cleanup job.

## 7. Alerts and Notifications

| Condition | Notification Channel | Urgency |
|---|---|---|
| Drive goes offline | WebSocket (real-time) + Email | High |
| Drive recovers from offline | WebSocket + Email | Medium |
| Drive quota below 10% | In-app notification + Email | Medium |
| Drive quota below 1% | In-app notification + Email + Push (future) | Critical |
| Health check fails 3 times consecutively | Email | High |
| Rebalancing completes | WebSocket | Low |

## 8. Dashboard Integration

The health monitor provides data for the Drive Health Dashboard in the UI:

| Metric | Source |
|---|---|
| Drive online/offline status | Latest health check |
| Drive utilization percentage | Latest quota check |
| Drive latency history | `health_checks` table |
| Uptime percentage (30-day) | Aggregated from `health_checks` |
| Last error message | Latest `health_checks` record with error |
| Rebalance status | Background job status |