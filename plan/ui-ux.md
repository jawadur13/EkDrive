# EkDrive — UI/UX Design

## 1. Design Philosophy

EkDrive's UI is designed around the principle that users should see **one storage system**, not multiple Google Drives. The interface should feel like a single, unified cloud drive with no visible complexity from the underlying distribution across accounts.

### Design Principles

1. **Transparency**: Users should never need to think about which Google Drive account holds their data.
2. **Simplicity**: The interface should be clean and minimal, with advanced features accessible but not overwhelming.
3. **Responsiveness**: The UI should feel fast, with immediate feedback for all user actions.
4. **Accessibility**: All interactive elements are keyboard-navigable and screen-reader friendly.
5. **Consistency**: Design patterns are consistent across the entire application.

## 2. Design System

### 2.1 Color Palette

| Role | Color | Usage |
|---|---|---|
| **Primary** | `#2563EB` (Blue 600) | Buttons, links, active states |
| **Primary Light** | `#DBEAFE` (Blue 50) | Button hover, selected states |
| **Success** | `#16A34A` (Green 600) | Success indicators, healthy drives |
| **Warning** | `#D97706` (Amber 600) | Warnings, degraded drives |
| **Error** | `#DC2626` (Red 600) | Errors, offline drives |
| **Neutral 50** | `#F9FAFB` | Page background |
| **Neutral 100** | `#F3F4F6` | Card backgrounds, dividers |
| **Neutral 200** | `#E5E7EB` | Borders |
| **Neutral 800** | `#1F2937` | Primary text |
| **Neutral 500** | `#6B7280` | Secondary text |

### 2.2 Typography

| Token | Font | Size | Weight | Usage |
|---|---|---|---|---|
| `heading-xl` | Inter | 32px | 700 | Page titles |
| `heading-lg` | Inter | 24px | 600 | Section titles |
| `heading-md` | Inter | 18px | 600 | Card titles |
| `body-lg` | Inter | 16px | 400 | Primary body text |
| `body-md` | Inter | 14px | 400 | Secondary text, labels |
| `body-sm` | Inter | 12px | 400 | Captions, metadata |
| `code` | JetBrains Mono | 14px | 400 | Code blocks, file paths |

### 2.3 Spacing

| Token | Value | Usage |
|---|---|---|
| `space-xs` | 4px | Inline spacing |
| `space-sm` | 8px | Compact spacing |
| `space-md` | 16px | Standard spacing |
| `space-lg` | 24px | Section spacing |
| `space-xl` | 32px | Page-level spacing |
| `space-2xl` | 48px | Hero spacing |

### 2.4 Border Radius

| Token | Value | Usage |
|---|---|---|
| `radius-sm` | 4px | Small elements (badges, tags) |
| `radius-md` | 8px | Cards, inputs, buttons |
| `radius-lg` | 12px | Modals, panels |
| `radius-full` | 9999px | Avatars, pills |

### 2.5 Shadows

| Token | Value | Usage |
|---|---|---|
| `shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle elevation |
| `shadow-md` | `0 4px 6px rgba(0,0,0,0.07)` | Cards, dropdowns |
| `shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Modals, popovers |

## 3. Key Screens

### 3.1 Dashboard (Home)

```
┌─────────────────────────────────────────────────────────────┐
│  [Sidebar]           EkDrive                              [🔔] [👤] │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  📁 All Files    📊 Storage  🔗 Drives  ⚙️ Settings   │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Storage Overview                                      │ │
│  │  ┌─────────────────────────────────────────────────┐   │ │
│  │  │  Total: 1.2 TB  │  Used: 780 GB  │  Free: 420 GB │   │ │
│  │  └─────────────────────────────────────────────────┘   │ │
│  │  [Usage Chart: 1.2 TB total across 3 drives]          │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Recent Files                                          │ │
│  │  ┌─────────────────────────────────────────────────┐   │ │
│  │  │ Name          │  Size    │  Modified    │  Drive │   │ │
│  │  │ report.pdf    │  2.4 MB  │  2 hours ago │  Work  │   │ │
│  │  │ video.mp4     │  150 MB  │  1 day ago   │  Personal│  │ │
│  │  │ notes.md      │  12 KB   │  3 days ago  │  Work  │   │ │
│  │  └─────────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Drive Health                                          │ │
│  │  [Drive 1: ● Online  500 GB free]  [Drive 2: ● Online  200 GB free] │ │
│  │  [Drive 3: 🟡 Degraded  50 GB free]                    │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 File Browser

- **Layout**: Two-panel view with folder tree on the left and file list on the right.
- **File List**: Virtual-scrolled, supports grid and table views.
- **Toolbar**: Search bar, upload button, view toggle, sort options, batch actions.
- **Context Menu**: Right-click or long-press shows file actions (download, share, rename, move, delete).
- **Breadcrumbs**: Shows the current virtual path for easy navigation.

### 3.3 Upload Flow

- **Drag-and-Drop Zone**: Prominent drop zone in the file browser.
- **Upload Queue**: Shows all active uploads with progress bars, speed, and ETA.
- **Chunk Detail**: Expandable rows show per-chunk progress for large files.
- **Pause/Resume**: Each upload can be paused and resumed.
- **Completion Notification**: Toast notification when upload completes.

### 3.4 Drive Management

- **Drive List**: Cards showing each connected drive with name, quota bar, status indicator, and last health check.
- **Add Drive**: Button to connect a new Google Drive account.
- **Drive Details**: Click a drive to see detailed health history, quota trends, and file distribution.
- **Disconnect**: Button to disconnect a drive (with confirmation).

### 3.5 Storage Mode Settings

- **Mode Selector**: Three cards representing Maximum Capacity, Balanced, and High Reliability.
- **Effective Capacity**: Shows how much usable space each mode provides.
- **Rebalance Button**: Triggers a manual rebalance with a confirmation dialog.
- **Per-Folder Overrides**: Ability to set a different mode for specific folders.

### 3.6 Notifications

- **Toast Notifications**: Non-blocking, auto-dismissing notifications for upload completion, sync status, and drive health changes.
- **Notification Center**: A dropdown panel showing all notifications with read/unread state.
- **Email Notifications**: Sent for critical alerts (drive offline, quota critical).

## 4. Interaction Patterns

### 4.1 File Operations

| Action | Feedback |
|---|---|
| Upload starts | Progress bar appears in the upload panel |
| Upload progresses | Real-time progress per chunk |
| Upload completes | Toast notification + file appears in the list |
| Download starts | Browser download dialog or inline preview |
| Delete | Confirmation dialog → file removed from list immediately (optimistic) |
| Rename | Inline editing with Enter to confirm, Escape to cancel |
| Move | Drag-and-drop to target folder or context menu |

### 4.2 Navigation

- **Breadcrumbs**: Click any segment to navigate to that folder.
- **Sidebar**: Folder tree with expand/collapse; highlights current folder.
- **Keyboard**: Arrow keys to navigate files, Enter to open, Backspace to go up.
- **Search**: Global search bar filters files across all folders in real-time.

### 4.3 Responsive Design

- **Desktop**: Full sidebar + file browser layout.
- **Tablet**: Collapsible sidebar, simplified toolbar.
- **Mobile**: Hamburger menu, bottom navigation, touch-optimized file actions.

## 5. Accessibility

| Requirement | Implementation |
|---|---|
| **Keyboard Navigation** | All interactive elements are focusable and operable via keyboard. |
| **Screen Reader** | ARIA labels on all icons, roles on all interactive elements, live regions for dynamic content. |
| **Color Contrast** | All text meets WCAG AA contrast ratio (4.5:1 minimum). |
| **Focus Management** | Focus is trapped in modals; focus returns to trigger element on close. |
| **Reduced Motion** | Respects `prefers-reduced-motion` media query; disables animations. |

## 6. Loading States

| Component | Loading State |
|---|---|
| **File list** | Skeleton rows while loading |
| **Charts** | Animated placeholder bars |
| **Buttons** | Spinner inside the button |
| **Page** | Full-page spinner for initial load |
| **Upload** | Progress bar with percentage |
| **Download** | Progress bar with percentage and ETA |