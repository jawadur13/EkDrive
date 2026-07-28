# EkDrive — Storage Engine

## 1. Purpose

The Storage Engine is the core decision-making layer that determines **where** files and chunks are placed across connected Google Drive accounts. It is the brain behind the unified storage pool, responsible for drive selection, load balancing, and redundancy management.

## 2. Core Concepts

### 2.1 Virtual Drive
A Virtual Drive is an abstraction over a connected Google Drive account. It exposes:
- Total quota
- Available (free) quota
- Current utilization percentage
- Health status (online/offline/degraded)
- Latency and rate-limit state

### 2.2 Placement Target
A Placement Target is a specific drive (or set of drives) selected to store a file or chunk. The selection is driven by the active storage mode and the current state of all connected drives.

### 2.3 Virtual Path → Physical Mapping
Every file in the virtual filesystem has a mapping that records:
- Which Google Drive account(s) hold its data
- The Google Drive folder ID where the file/chunk resides
- The Google Drive file ID(s) for each chunk
- The chunk index (for chunked files)

This mapping is stored in the `files.drive_assignments` JSONB column and the `chunks` table.

## 3. Drive Selection Algorithm

### 3.1 Input Parameters
- `file_size_bytes`: Size of the file or chunk to be placed
- `user_id`: Owner of the virtual filesystem
- `storage_mode`: Active mode (`max_capacity`, `balanced`, `high_reliability`)
- `min_replicas`: Number of copies required (1 for most modes, >1 for high reliability)
- `exclude_drives`: Drives to exclude (offline, quota exceeded, etc.)

### 3.2 Maximum Capacity Mode

**Goal**: Place files on the drive with the most free space to maximize utilization of the largest drives.

**Algorithm**:
1. Retrieve all online drives for the user, sorted by `available_quota_bytes` descending.
2. Filter out drives where `available_quota_bytes < file_size_bytes`.
3. Select the drive with the highest available quota.
4. If no single drive has enough space and the file is chunkable:
   - Split the file into chunks.
   - Assign each chunk to the drive with the most available space at the time of assignment.
5. Return the placement plan (drive ID → chunk index mapping).

**Pseudocode**:
```
function selectDriveMaxCapacity(drives, fileSize):
    eligible = drives.filter(d => d.status == 'online' && d.available >= fileSize)
    if eligible is not empty:
        return [eligible[0]]  // single drive, largest first
    else if fileSize > maxDriveCapacity:
        return chunkAndDistribute(drives, fileSize, maxCapacityStrategy)
    else:
        return null  // insufficient space
```

### 3.3 Balanced Mode

**Goal**: Distribute files evenly across all drives to prevent any single drive from filling up prematurely.

**Algorithm**:
1. Retrieve all online drives for the user, sorted by `available_quota_bytes` descending.
2. Calculate the average utilization across all drives: `avg_util = sum(used / total) / N`.
3. Filter out drives where utilization exceeds `avg_util + rebalance_threshold` (default 20%).
4. From the remaining drives, select the one with the most available space that can fit the file.
5. If no single drive can fit the file and chunking is needed:
   - Distribute chunks to drives with the lowest utilization first.
6. Return the placement plan.

**Pseudocode**:
```
function selectDriveBalanced(drives, fileSize, threshold=0.2):
    eligible = drives.filter(d => d.status == 'online')
    avgUtil = sum(d.used / d.total for d in eligible) / len(eligible)
    balanced = eligible.filter(d => (d.used / d.total) <= avgUtil + threshold)
    if balanced is not empty:
        sort balanced by available desc
        return [first drive that fits fileSize]
    else:
        return chunkAndDistribute(drives, fileSize, balancedStrategy)
```

### 3.4 High Reliability Mode

**Goal**: Store redundant copies of each chunk across different drives so that data survives any single drive failure.

**Algorithm**:
1. Retrieve all online drives for the user, sorted by `available_quota_bytes` descending.
2. For each chunk of the file:
   a. Select `min_replicas` distinct drives (default 2, configurable).
   b. Each selected drive must have enough space for the chunk.
   c. Drives must be different for each replica of the same chunk.
   d. Prefer drives that are geographically or topologically diverse (if metadata is available).
3. If any chunk cannot be placed on `min_replicas` drives, the upload is rejected with a clear error.
4. Return the placement plan with replication mapping.

**Pseudocode**:
```
function selectDrivesHighReliability(drives, fileSize, minReplicas=2):
    eligible = drives.filter(d => d.status == 'online')
    chunks = splitIntoChunks(fileSize, chunkSize)
    placement = {}
    for each chunk in chunks:
        candidates = eligible.filter(d => d.available >= chunk.size)
        if len(candidates) < minReplicas:
            return FAILURE("Insufficient drives for redundancy")
        selected = candidates.slice(0, minReplicas)
        placement[chunk.index] = [d.id for d in selected]
        for d in selected:
            d.available -= chunk.size  // reserve space
    return placement
```

## 4. Chunk Size Configuration

| Parameter | Default | Description |
|---|---|---|
| `chunk_size_bytes` | 50 MB | Size of each chunk for chunked files |
| `min_chunk_size_bytes` | 10 MB | Minimum chunk size (files smaller than this are stored as single chunks) |
| `max_chunk_size_bytes` | 250 MB | Maximum chunk size (hard limit) |

The chunk size is configurable per user or per deployment. Larger chunks reduce metadata overhead but increase the minimum drive size requirement.

## 5. Space Reservation

When a chunk is assigned to a drive, the Storage Engine reserves space by decrementing the drive's `available_quota_bytes` in memory (and eventually in the database). This prevents double-booking during concurrent uploads.

**Reservation Flow**:
1. Storage Engine selects drives for a file.
2. Reserves space by updating `available_quota_bytes` for each selected drive.
3. Upload begins.
4. On upload success, the reservation is confirmed and `used_quota_bytes` is updated.
5. On upload failure, the reservation is released (space is restored).

## 6. Rebalancing

Rebalancing is triggered when:
- A drive goes offline and its files need to be redistributed.
- A drive recovers and has excess capacity.
- A user manually triggers a rebalance.
- A drive's utilization exceeds the threshold defined in storage mode settings.

**Rebalancing Algorithm**:
1. Identify over-utilized drives (utilization > average + threshold).
2. Identify under-utilized drives (utilization < average - threshold).
3. For each over-utilized drive, select files/chunks to migrate.
4. Prioritize migrating chunks of chunked files (can be moved individually).
5. For non-chunked files, the entire file must be moved (copy to new drive, then delete from old).
6. Update `drive_assignments` and `chunks` table entries.
7. Update quota counters on both source and destination drives.

**Constraints**:
- Rebalancing must not violate redundancy requirements (High Reliability mode).
- Rebalancing must not exceed per-drive rate limits.
- Rebalancing is a background job and does not block user operations.