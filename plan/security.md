# EkDrive — Security

## 1. Security Principles

EkDrive handles user data stored across third-party cloud accounts (Google Drive). Security is paramount because:
- User data is stored on Google's infrastructure, which EkDrive does not directly control.
- OAuth tokens grant access to user Google Drive accounts.
- The platform acts as a intermediary, meaning a compromise could expose data across multiple Google accounts.

The security model follows the principle of least privilege, defense in depth, and zero trust.

## 2. Authentication Security

### 2.1 OAuth 2.0 Security

| Concern | Mitigation |
|---|---|
| **Authorization Code Interception** | PKCE (Proof Key for Code Exchange) prevents authorization code interception attacks. |
| **CSRF in OAuth Flow** | `state` parameter with cryptographically random value; validated on callback. |
| **Redirect URI Manipulation** | Strict allowlist of registered redirect URIs in Google Cloud Console; no open redirectors. |
| **Token Storage** | OAuth tokens encrypted at rest using AES-256-GCM with a per-user encryption key. |
| **Token Scope Minimization** | Uses `drive.file` scope (per-file access) rather than `drive` (full account access). |
| **Token Refresh** | Refresh tokens are rotated on each use; old tokens are invalidated. |

### 2.2 Session Security

| Concern | Mitigation |
|---|---|
| **JWT Theft** | Access tokens are short-lived (1 hour); refresh tokens are stored in httpOnly, secure, SameSite=Strict cookies. |
| **Session Fixation** | New session ID issued after authentication; old sessions invalidated. |
| **Session Hijacking** | JWTs are bound to the user's IP and user-agent; anomalies trigger re-authentication. |
| **Concurrent Sessions** | Users can view and revoke active sessions from Settings → Security. |

## 3. Data Security

### 3.1 Encryption

| Data | Encryption Method |
|---|---|
| **OAuth Tokens** | AES-256-GCM, encrypted at rest in PostgreSQL. |
| **Data in Transit** | TLS 1.3 for all client-server and server-Google API communication. |
| **Chunk Data** | Chunks stored in Google Drive are encrypted by Google (at rest). MinIO storage uses server-side encryption. |
| **Database Fields** | Sensitive fields (email, display name) are encrypted at the application level before storage. |

### 3.2 Key Management

- Encryption keys for OAuth tokens are managed by a key management system (KMS).
- In development, a local key is used (never committed to version control).
- In production, keys are stored in environment variables or a cloud KMS (AWS KMS, GCP KMS).
- Key rotation is supported and should be performed annually or on compromise.

### 3.3 Data Isolation

- Every database query is scoped to `user_id`.
- No cross-user data access is possible through the API.
- Google Drive files are created in EkDrive-managed root folders, isolating them from the user's other Google Drive content.

## 4. API Security

### 4.1 Rate Limiting

| Scope | Limit | Window |
|---|---|---|
| **Per User** | 100 requests/minute | Sliding window |
| **Per Drive** | 10 requests/second | Sliding window |
| **Per Endpoint** | Configurable per route | Sliding window |
| **Upload Bandwidth** | Per-user bandwidth cap | Rolling window |

Rate limiting is enforced at the API Gateway level (Nginx/Caddy) and at the application level (BullMQ job throttling).

### 4.2 Input Validation

- All API inputs are validated using Zod schemas before processing.
- File names are sanitized to prevent path traversal attacks.
- File sizes are validated against configurable limits (default 10 GB per file).
- Virtual paths are validated to prevent directory traversal (`..`, absolute paths, etc.).

### 4.3 CORS

- CORS is configured to allow only trusted origins.
- Credentials are not exposed to untrusted origins.
- Preflight requests are cached for 1 hour.

## 5. Google Drive API Security

### 5.1 Scope Management

- The `drive.file` scope is used by default, which restricts EkDrive to files it created or opened.
- If broader access is needed (e.g., for scanning existing files), the `drive.readonly` scope can be requested with explicit user consent.
- Users can revoke EkDrive's access at any time via their Google Account security settings.

### 5.2 API Quota Management

- Google Drive API has daily quota limits (10,000 requests/day by default).
- EkDrive tracks quota usage per drive and throttles requests when approaching limits.
- Exponential backoff is applied on 429 responses.
- If quota is exhausted, the drive is marked as `quota_exceeded` and the user is notified.

## 6. Application Security

### 6.1 Common Vulnerabilities

| Vulnerability | Mitigation |
|---|---|
| **SQL Injection** | Prisma ORM uses parameterized queries; no raw SQL for user input. |
| **XSS** | React auto-escapes content; CSP headers enforced; no `dangerouslySetInnerHTML` with user data. |
| **CSRF** | SameSite=Strict cookies; CSRF tokens for state-changing operations; OAuth state parameter. |
| **Path Traversal** | Virtual paths are validated; no direct filesystem access; all file operations go through the File Service. |
| **Insecure Deserialization** | No `eval()` or `Function()` with user input; JSON parsing uses safe parsers. |
| **Dependency Vulnerabilities** | `npm audit` in CI; Dependabot for automatic dependency updates; Snyk for vulnerability scanning. |

### 6.2 Security Headers

| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline' (trusted CDNs); style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://www.googleapis.com; frame-src 'none';` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |

## 7. Audit and Monitoring

| Concern | Implementation |
|---|---|
| **Access Logging** | All API requests are logged with user ID, IP, timestamp, endpoint, and status code. |
| **Security Events** | Failed login attempts, token refresh failures, and permission errors are logged as security events. |
| **Alerting** | Security events trigger alerts via email and WebSocket for anomalous patterns (e.g., multiple failed logins, unusual API usage). |
| **Audit Trail** | All file operations (create, update, delete, share) are logged with timestamps and user context. |
| **Penetration Testing** | Scheduled annually or before major releases. |

## 8. Compliance Considerations

- **GDPR**: User data is stored in PostgreSQL with encryption at rest. Users can request data export or deletion.
- **SOC 2**: Infrastructure and processes should be designed to meet SOC 2 Type II requirements.
- **Google API Terms of Service**: EkDrive complies with Google API Services User Data Policy, including no resale of user data and no use of data for purposes other than providing the service.