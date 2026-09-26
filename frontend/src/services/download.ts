// Plain URLs: the browser streams these directly, with the session cookie attached.

export function getDownloadUrl(fileId: string) {
  return `/api/v1/files/${fileId}/download`;
}

export function getPreviewUrl(fileId: string) {
  return `/api/v1/files/${fileId}/preview`;
}

export function getShareUrl(token: string) {
  return `${window.location.origin}/api/v1/shares/public/${token}/content`;
}
