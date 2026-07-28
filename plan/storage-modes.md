# EkDrive — Storage Modes

## 1. Overview

Storage Modes determine how EkDrive distributes files and chunks across connected Google Drive accounts. Each mode has a different trade-off between capacity utilization, performance, and data durability.

## 2. Mode Definitions

### 2.1 Maximum Capacity

**Goal**: Use as much total storage as possible by placing files on the drive with the most free space.

| Property | Value |
|---|---|
| `min_replicas` | 1 |
| `placement_strategy` | `max_capacity` |
| `rebalance_threshold` | 0.25 (25%) |
| `description` | Prioritizes filling up the largest drives first. Best for users who want to maximize total usable space. |

**Behavior**:
- Files are placed on the drive with the most available space.
- No redundant copies are stored.
- If a drive fails, files on that drive are lost (recoverable only from Google Drive's own backup if available).
- Rebalancing moves files from over-utilized drives to under-utilized ones.

**Best for**: Users with many small files who want to maximize total storage utilization.

### 2.2 Balanced

**Goal**: Distribute files evenly across all drives to prevent any single drive from filling up prematurely.

| Property | Value |
|---|---|
| `min_replicas` | 1 |
| `placement_strategy` | `balanced` |
| `rebalance_threshold` | 0.20 (20%) |
| `description` | Distributes files to keep utilization even across all drives. |

**Behavior**:
- Files are placed on the drive with the lowest utilization (among drives with sufficient space).
- No redundant copies are stored.
- Rebalancing is more aggressive than Maximum Capacity mode.
- If a drive fails, files on that drive are lost.

**Best for**: Users who want even distribution and predictable capacity across all drives.

### 2.3 High Reliability

**Goal**: Store redundant copies of each chunk across multiple drives so that data survives any single drive failure.

| Property | Value |
|---|---|
| `min_replicas` | 2 (configurable, default 2) |
| `placement_strategy` | `high_reliability` |
| `rebalance_threshold` | 0.15 (15%) |
| `description` | Stores each chunk on at least 2 different drives. Best for critical data that cannot afford any single drive failure. |

**Behavior**:
- Each chunk is stored on at least `min_replicas` different drives.
- If a drive goes offline, chunks can be fetched from a redundant copy.
- Storage efficiency is reduced: each chunk consumes space on `min_replicas` drives.
- Rebalancing must ensure redundancy is maintained during migration.
- If the number of online drives drops below `min_replicas`, new uploads are rejected.

**Best for**: Users storing critical or irreplaceable data.

## 3. Mode Selection

### 3.1 Default Mode

- New users default to **Balanced** mode.
- Users can change their mode at any time from Settings → Storage Mode.

### 3.2 Per-File Override

- Users can override the storage mode for individual files or folders.
- Example: A user in Balanced mode can mark a specific folder as High Reliability.
- The override is stored in the `files` table as a `storage_mode_override` column (nullable).

### 3.3 Mode Change Effects

| Mode Change | Effect |
|---|---|
| Balanced → Maximum Capacity | No immediate action. New uploads use the new strategy. Existing files remain where they are. |
| Maximum Capacity → Balanced | Rebalancing is triggered to distribute files more evenly. |
| Any mode → High Reliability | Existing files are not automatically duplicated. New uploads use redundancy. Users can manually trigger a rebalance to add redundancy to existing files. |
| High Reliability → Any other mode | Redundant copies are not automatically removed. New uploads use single placement. |

## 4. Rebalancing on Mode Change

When a user changes their storage mode, the system may trigger a rebalance:

1. **Balanced → Maximum Capacity**: No rebalance needed.
2. **Maximum Capacity → Balanced**: Rebalance to distribute files evenly.
3. **Any mode → High Reliability**: Rebalance to add redundant copies for all files.
4. **High Reliability → Any other mode**: No automatic rebalance (redundant copies remain but are not required).

Rebalancing is a background job that runs asynchronously. The user is notified when rebalancing is complete.

## 5. Storage Mode Configuration Schema

```json
{
  "mode": "balanced",
  "min_replicas": 1,
  "rebalance_threshold": 0.20,
  "per_file_overrides": [
    {
      "folder_path": "/Projects/Critical",
      "mode": "high_reliability",
      "min_replicas": 3
    }
  ]
}
```

## 6. Capacity Calculations

### 6.1 Effective Capacity

| Mode | Effective Capacity Formula |
|---|---|
| Maximum Capacity | `sum(drive.available_quota_bytes for all drives)` |
| Balanced | `sum(drive.available_quota_bytes for all drives)` |
| High Reliability (min_replicas=2) | `sum(drive.available_quota_bytes for all drives) / 2` |
| High Reliability (min_replicas=N) | `sum(drive.available_quota_bytes for all drives) / N` |

### 6.2 Minimum Drives for High Reliability

- `min_replicas` must be less than or equal to the number of online drives.
- If `online_drives < min_replicas`, new uploads are rejected with a clear error message.
- Existing files remain accessible from redundant copies.

## 7. Trade-Off Summary

| Mode | Capacity Efficiency | Durability | Performance | Best Use Case |
|---|---|---|---|---|
| Maximum Capacity | High | Low | High | Maximizing total storage |
| Balanced | Medium | Low | Medium | General-purpose use |
| High Reliability | Low | High | Medium (more fetches) | Critical data protection |