# EkDrive — Future Features Roadmap

## 1. Post-Launch Feature Roadmap

This document outlines features planned for EkDrive beyond the initial v1 launch. Features are organized by priority and estimated complexity.

## 2. Near-Term (v1.1 — Q3 2026)

### 2.1 Third-Party Cloud Storage Support

| Feature | Description | Complexity |
|---|---|---|
| **OneDrive integration** | Connect Microsoft OneDrive accounts as additional storage backends | Medium |
| **Dropbox integration** | Connect Dropbox accounts as additional storage backends | Medium |
| **S3-compatible storage** | Support any S3-compatible object storage (MinIO, Wasabi, Backblaze B2) | High |
| **Unified provider abstraction** | Abstract storage provider interface so new providers can be added without changing core logic | High |

### 2.2 Enhanced Storage Modes

| Feature | Description | Complexity |
|---|---|---|
| **Custom placement rules** | Users can define rules like "store all `.zip` files on Drive A" | Medium |
| **Geographic placement** | Place chunks in drives based on geographic region for latency optimization | High |
| **Cost-aware placement** | Consider storage costs when placing files (e.g., prefer cheaper drives) | Medium |
| **Tiered storage** | Automatically move infrequently accessed files to slower/cheaper storage | High |

### 2.3 Improved Sync

| Feature | Description | Complexity |
|---|---|---|
| **Real-time sync** | Use Google Drive push notifications instead of polling for change detection | High |
| **Selective sync** | Users can choose which folders to sync (not all folders need to be synced) | Medium |
| **Sync bandwidth throttling** | Limit sync bandwidth to avoid impacting user's network | Low |
| **Version history** | Maintain a version history of files within EkDrive (beyond Google Drive's native versioning) | High |

## 3. Medium-Term (v1.2 — Q4 2026)

### 3.1 Collaboration

| Feature | Description | Complexity |
|---|---|---|
| **File sharing with permissions** | Share files/folders with other EkDrive users with view/edit permissions | High |
| **Shared folders** | Create folders that multiple users can access | High |
| **Activity feed** | Show a timeline of file operations across all users | Medium |
| **Comments/annotations** | Add comments and annotations to files | Medium |

### 3.2 Mobile Support

| Feature | Description | Complexity |
|---|---|---|
| **Progressive Web App (PWA)** | Installable PWA with offline support and push notifications | Medium |
| **Native mobile apps** | React Native apps for iOS and Android | High |
| **Camera upload** | Automatically upload photos taken on mobile to EkDrive | Medium |
| **Background sync** | Sync files in the background on mobile devices | High |

### 3.3 Advanced Preview

| Feature | Description | Complexity |
|---|---|---|
| **Office document preview** | Render Microsoft Office documents (DOCX, XLSX, PPTX) in the browser | High |
| **CAD file preview** | Render 3D models (STL, OBJ, STEP) in the browser | High |
| **Code diff viewer** | Show diffs between file versions | Medium |
| **Audio waveform** | Visual waveform for audio files | Low |
| **Video scrubbing** | Seekable video preview with thumbnail scrubber | Medium |

## 4. Long-Term (v2.0 — 2027)

### 4.1 End-to-End Encryption

| Feature | Description | Complexity |
|---|---|---|
| **Client-side encryption** | Files are encrypted on the client before upload; keys never leave the client | Very High |
| **Zero-knowledge architecture** | EkDrive cannot read user file contents; encryption/decryption happens entirely client-side | Very High |
| **Key management** | User-managed encryption keys with secure key recovery | High |
| **Shared encrypted files** | Share encrypted files with other users who have the decryption key | Very High |

### 4.2 Enterprise Features

| Feature | Description | Complexity |
|---|---|---|
| **SSO / SAML** | Enterprise single sign-on via SAML 2.0 | High |
| **Role-based access control** | Admin, editor, viewer roles for shared folders | High |
| **Audit logs** | Comprehensive audit trail of all file operations | Medium |
| **Data residency** | Choose which geographic region stores user data | High |
| **API access** | Public API for programmatic access to EkDrive | Medium |
| **Webhooks** | Event-based notifications for file changes | Medium |

### 4.3 Advanced Storage

| Feature | Description | Complexity |
|---|---|---|
| **Erasure coding** | Use erasure coding instead of simple replication for more efficient redundancy | Very High |
| **Deduplication** | Deduplicate identical chunks across all files and users | High |
| **Compression** | Transparent compression of chunks before upload | Medium |
| **Content-addressable storage** | Content-addressed chunk storage for deduplication and integrity | High |
| **Multi-cloud support** | Combine Google Drive, OneDrive, Dropbox, and S3 in a single pool | Very High |

### 4.4 AI-Powered Features

| Feature | Description | Complexity |
|---|---|---|
| **Smart file organization** | AI suggests folder structure based on file types and usage patterns | High |
| **Duplicate detection** | AI identifies duplicate or near-duplicate files across all drives | High |
| **Content-based search** | Search file contents (not just names) using AI-powered indexing | Very High |
| **Automatic tagging** | AI auto-tags files based on content (images, documents, etc.) | High |
| **Storage recommendations** | AI suggests which files to archive or delete to free space | Medium |

## 5. Feature Prioritization Matrix

| Feature | Impact | Effort | Priority | Target Version |
|---|---|---|---|---|
| OneDrive integration | High | Medium | P1 | v1.1 |
| Dropbox integration | Medium | Medium | P2 | v1.1 |
| Custom placement rules | Medium | Medium | P2 | v1.1 |
| Real-time sync | High | High | P1 | v1.2 |
| File sharing with permissions | High | High | P1 | v1.2 |
| PWA support | Medium | Medium | P2 | v1.2 |
| Office document preview | Medium | High | P3 | v2.0 |
| End-to-end encryption | Very High | Very High | P1 (long-term) | v2.0 |
| SSO / SAML | High | High | P2 (enterprise) | v2.0 |
| Erasure coding | Very High | Very High | P3 (long-term) | v2.0 |
| AI content search | Very High | Very High | P3 (long-term) | v2.1+ |

## 6. Architectural Decisions for Future Features

### 6.1 Provider Abstraction

To support multiple cloud storage providers, the Storage Engine will be refactored to use a provider interface:

```typescript
interface StorageProvider {
  name: string;
  connect(oauthToken: string): Promise<ProviderConnection>;
  listFiles(folderId: string): Promise<ProviderFile[]>;
  uploadChunk(chunk: Buffer, folderId: string): Promise<string>;
  downloadChunk(fileId: string): Promise<Buffer>;
  deleteFile(fileId: string): Promise<void>;
  getQuota(): Promise<ProviderQuota>;
  checkHealth(): Promise<ProviderHealth>;
}
```

### 6.2 Encryption Layer

For end-to-end encryption, a transparent encryption layer will be added between the Chunking System and the Storage Engine:

```
Client → Encrypt chunk → Chunking System → Storage Engine → Google Drive
Client ← Decrypt chunk ← Chunking System ← Storage Engine ← Google Drive
```

- Encryption keys are derived from the user's password (or a key management service).
- The encryption layer is pluggable and can be disabled for non-encrypted deployments.
- Key rotation is supported without re-encrypting all data.

### 6.3 Multi-Cloud Architecture

The current architecture is designed to be provider-agnostic at the Storage Engine level. Adding new providers requires:
1. Implementing the `StorageProvider` interface.
2. Adding provider-specific OAuth flow in the Auth Service.
3. Configuring provider-specific rate limits and quotas.
4. Adding provider to the drive selection algorithm.

The core logic (chunking, placement, sync, health) remains unchanged.