# EkDrive — Frontend Architecture

## 1. Overview

The frontend is a React Single Page Application (SPA) that provides the user interface for interacting with the EkDrive virtual filesystem. It is built with TypeScript, Vite, and React Router, and uses a modular architecture with clear separation of concerns.

## 2. Project Structure

```
src/
├── app/
│   ├── App.tsx                    # Root component with routing
│   ├── routes.tsx                 # Route definitions
│   └── providers.tsx              # Context providers (Auth, Query, WebSocket)
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx            # Navigation sidebar with drive status
│   │   ├── Header.tsx             # Top bar with search, notifications, user menu
│   │   └── Shell.tsx              # Main layout wrapper
│   ├── files/
│   │   ├── FileList.tsx           # Virtual-scrolled file list
│   │   ├── FileRow.tsx            # Individual file row
│   │   ├── FilePreview.tsx        # Preview component for supported types
│   │   ├── UploadDropzone.tsx     # Drag-and-drop upload zone
│   │   ├── Breadcrumbs.tsx        # Virtual path breadcrumbs
│   │   └── FileActions.tsx        # Context menu (download, share, delete, rename)
│   ├── drives/
│   │   ├── DriveHealthPanel.tsx   # Drive health dashboard
│   │   ├── DriveList.tsx          # List of connected drives
│   │   └── DriveUsageChart.tsx    # Storage usage chart per drive
│   ├── settings/
│   │   ├── StorageModeSelector.tsx # Storage mode configuration
│   │   ├── ConnectedDrives.tsx    # Manage connected drives
│   │   └── AccountSettings.tsx    # User profile and security
│   └── shared/
│       ├── Button.tsx
│       ├── Modal.tsx
│       ├── Toast.tsx
│       ├── Spinner.tsx
│       ├── EmptyState.tsx
│       └── ErrorBoundary.tsx
├── hooks/
│   ├── useAuth.ts                 # Authentication state and methods
│   ├── useFiles.ts                # File CRUD operations
│   ├── useDriveHealth.ts          # Drive health monitoring
│   ├── useUpload.ts               # Upload state and progress
│   ├── useDownload.ts             # Download state and progress
│   ├── useSearch.ts               # File search
│   ├── useWebSocket.ts            # WebSocket connection and events
│   └── useStorageMode.ts          # Storage mode state
├── services/
│   ├── api.ts                     # Axios/fetch HTTP client with interceptors
│   ├── auth.ts                    # Authentication API calls
│   ├── files.ts                   # File API calls
│   ├── drives.ts                  # Drive API calls
│   ├── upload.ts                  # Upload API calls
│   ├── download.ts                # Download API calls
│   ├── sync.ts                    # Sync API calls
│   └── websocket.ts               # WebSocket connection manager
├── stores/
│   ├── authStore.ts               # Auth state (Zustand)
│   ├── fileStore.ts               # File tree and metadata state
│   ├── driveStore.ts              # Drive state and health
│   ├── uploadStore.ts             # Upload progress and queue
│   └── notificationStore.ts       # Toast notifications
├── workers/
│   ├── chunking.worker.ts         # Web Worker for file chunking
│   ├── checksum.worker.ts         # Web Worker for checksum computation
│   └── encoding.worker.ts         # Web Worker for file encoding
├── types/
│   ├── api.ts                     # API request/response types
│   ├── file.ts                    # File entity types
│   ├── drive.ts                   # Drive entity types
│   └── storage.ts                 # Storage mode and placement types
├── utils/
│   ├── formatBytes.ts            # Byte formatting utility
│   ├── path.ts                    # Virtual path manipulation
│   ├── checksum.ts                # Checksum computation (client-side)
│   └── validation.ts              # Input validation
├── styles/
│   ├── global.css                 # Global styles and CSS variables
│   └── themes.ts                  # Theme configuration
└── main.tsx                       # Entry point
```

## 3. State Management

### 3.1 Zustand Stores

| Store | State | Actions |
|---|---|---|
| `authStore` | `user`, `isAuthenticated`, `isLoading` | `login()`, `logout()`, `refreshSession()` |
| `fileStore` | `files`, `currentFolder`, `fileTree`, `selectedFiles` | `fetchFiles()`, `createFile()`, `deleteFile()`, `moveFile()`, `setCurrentFolder()` |
| `driveStore` | `drives`, `driveHealth`, `storageMode` | `fetchDrives()`, `updateDriveStatus()`, `setStorageMode()` |
| `uploadStore` | `uploads`, `activeUploads` | `addUpload()`, `updateProgress()`, `cancelUpload()`, `removeUpload()` |
| `notificationStore` | `notifications` | `addNotification()`, `removeNotification()`, `clearAll()` |

### 3.2 Server State (TanStack Query)

TanStack Query manages server state for API data:
- **Queries**: File lists, drive details, storage mode, sync status.
- **Mutations**: File CRUD, upload initiation, share link creation.
- **Cache**: Stale-while-revalidate strategy with 5-minute cache time.
- **Optimistic Updates**: File operations (rename, move, delete) update the UI immediately and roll back on failure.

## 4. Routing

| Route | Component | Description |
|---|---|---|
| `/` | `FileList` | Root of the virtual filesystem |
| `/folder/:folderId` | `FileList` | Navigate into a folder |
| `/file/:fileId` | `FileDetail` | File detail view with preview |
| `/settings` | `Settings` | User settings page |
| `/settings/drives` | `ConnectedDrives` | Manage connected Google Drive accounts |
| `/settings/storage` | `StorageMode` | Configure storage mode |
| `/settings/security` | `SecuritySettings` | Manage sessions, change password |
| `/login` | `Login` | Login page (redirects to Google OAuth) |
| `/auth/callback` | `AuthCallback` | OAuth callback handler |
| `*` | `NotFound` | 404 page |

## 5. Key Components

### 5.1 FileList Component
- Uses `@tanstack/virtual` for virtual scrolling of large file lists.
- Displays files and folders in a table or grid view (toggleable).
- Columns: name, type, size, modified date, storage mode badge, drive assignment.
- Supports multi-select for batch operations.
- Context menu for file actions (download, share, rename, delete, move).

### 5.2 UploadDropzone Component
- Drag-and-drop zone for file uploads.
- Shows upload progress per file with chunk-level detail.
- Supports pause/resume for individual uploads.
- Displays estimated time remaining and throughput.

### 5.3 DriveHealthPanel Component
- Shows a dashboard of all connected drives.
- Visual indicators for online/offline/degraded status.
- Usage bars showing quota utilization.
- Last health check timestamp.
- Reconnect button for offline drives.

### 5.4 StorageModeSelector Component
- Radio buttons or segmented control for selecting storage mode.
- Shows effective capacity for each mode.
- Warning for High Reliability mode (reduced capacity).
- Rebalance button that triggers a manual rebalance.

## 6. Web Workers

### 6.1 Chunking Worker
- Receives a `File` object and chunk configuration.
- Splits the file into chunks using `File.slice()`.
- Computes checksums for each chunk.
- Returns chunk metadata to the main thread.

### 6.2 Checksum Worker
- Receives a `Blob` or `ArrayBuffer` and computes its checksum.
- Supports xxHash (fast) and SHA-256 (verification).
- Used for both upload (pre-upload verification) and download (post-download verification).

### 6.3 Encoding Worker
- Handles file encoding/transcoding for preview (e.g., image resizing, video thumbnail extraction).
- Runs off the main thread to avoid UI blocking.

## 7. WebSocket Integration

- The WebSocket connection is established when the app mounts.
- Event handlers update the relevant Zustand stores.
- Connection is automatically re-established if disconnected.
- Events are logged for debugging.

## 8. Performance Considerations

| Concern | Strategy |
|---|---|
| **Large file lists** | Virtual scrolling with `@tanstack/virtual`. |
| **File preview** | Lazy loading of preview components; only render when in viewport. |
| **Upload memory** | Chunks are processed in Web Workers; no large buffers on the main thread. |
| **Bundle size** | Code-splitting with React.lazy for route components. |
| **API calls** | TanStack Query caching and deduplication. |
| **WebSocket** | Single connection; events are batched if multiple arrive in the same tick. |