# EkDrive — Vision Document

## 1. Problem Statement

Users who rely on Google Drive for storage often hit per-account storage limits. Google Workspace plans offer more space, but switching between accounts is cumbersome and disrupts workflow. There is no unified abstraction that lets a user treat multiple Google Drive accounts as a single, coherent storage pool with intelligent file placement, redundancy, and transparent access.

## 2. Vision

EkDrive is a virtual cloud storage platform that abstracts multiple Google Drive accounts into a single unified storage interface. Users interact with one logical drive — EkDrive — while the platform transparently manages storage allocation, file placement, chunking, redundancy, health monitoring, and synchronization across all connected Google accounts.

### Core Principles

- **Single Interface, Multiple Backends**: The user sees one storage volume. EkDrive handles the complexity of distributing data across underlying Google Drive accounts.
- **Intelligent Placement**: Files are placed on the most appropriate drive based on the active storage mode (capacity, balanced, reliability).
- **Chunking for Large Files**: Files larger than any individual drive's free space are split into chunks and distributed across drives.
- **Redundancy by Design**: High Reliability mode stores redundant copies so data survives a drive going offline.
- **Transparent Operations**: Uploads, downloads, previews, and searches feel native to a single filesystem, regardless of which backend drive holds the data.
- **Resilience**: Automatic health monitoring, drive reconnection, and recovery ensure data remains accessible.

## 3. Target Users

| Segment | Use Case |
|---|---|
| **Power users** | Individuals with multiple Google accounts who need seamless access to all their storage without switching accounts. |
| **Small teams** | Small organizations that want to pool storage from multiple accounts without setting up a full enterprise file server. |
| **Content creators** | Users working with large media files (video, raw photos) that exceed single-drive limits. |
| **Privacy-conscious users** | Users who want to distribute sensitive data across accounts so no single account holds all their data. |

## 4. Key Capabilities

### 4.1 Unified Storage Pool
- Aggregate total capacity and usage across all connected Google Drive accounts.
- Present a single virtual filesystem with a clean directory tree.
- Support arbitrary nesting of folders and files.

### 4.2 Smart File Placement
- **Maximum Capacity**: Place files on the drive with the most free space.
- **Balanced**: Distribute files evenly to avoid skewing any single drive.
- **High Reliability**: Store redundant copies on multiple drives so any single drive failure does not cause data loss.

### 4.3 File Chunking
- Split files larger than the largest individual drive's free space into chunks.
- Distribute chunks across multiple drives transparently.
- Reassemble chunks on download without the user's knowledge.

### 4.4 File Operations
- Upload files and folders (including recursive folder upload).
- Download files and folders (preserving structure).
- Stream previews for common file types (images, PDFs, text, video, audio).
- Share files via generated links or direct Google Drive sharing.
- Search across all files in the virtual filesystem.

### 4.5 Health Monitoring
- Continuously monitor the connectivity and quota status of each connected drive.
- Automatically detect offline drives and attempt reconnection.
- Alert users when drives are low on space or unhealthy.
- Trigger rebalancing when a drive recovers or fails.

### 4.6 Synchronization
- Detect changes in the virtual filesystem and sync them to the appropriate Google Drive accounts.
- Handle conflicts when the same file is modified in multiple places.
- Support offline editing with conflict resolution on reconnection.

## 5. Non-Goals (Initial Phase)

- Native mobile apps (web-only initially).
- End-to-end encryption (TLS in transit is sufficient for v1).
- Collaboration features (real-time co-editing).
- Version control beyond Google Drive's native versioning.
- Third-party cloud providers (Google Drive only in v1).

## 6. Success Metrics

- Users can connect 2+ Google Drive accounts and see a unified storage pool.
- Files upload and download transparently with no user awareness of backend distribution.
- Files larger than any single drive's free space upload successfully via chunking.
- Drive health status is visible and actionable within the UI.
- System achieves 99.9% availability for connected drives that are online.