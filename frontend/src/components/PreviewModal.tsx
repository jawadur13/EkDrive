import { useEffect } from 'react';
import { getDownloadUrl, getPreviewUrl } from '../services/download';

export interface PreviewFile {
  id: string;
  name: string;
  mime_type: string | null;
}

export function canPreview(mime: string | null) {
  return Boolean(mime && (/^image\/(png|jpe?g|gif|webp|avif|bmp)$/.test(mime) || /^(video|audio)\//.test(mime) || mime === 'application/pdf' || mime === 'text/plain'));
}

export function PreviewModal({ file, onClose }: { file: PreviewFile; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const url = getPreviewUrl(file.id);
  const mime = file.mime_type ?? '';
  // Video and audio stream with Range requests, so seeking works without loading everything.
  const body = mime.startsWith('image/') ? (
    <img src={url} alt={file.name} className="max-h-[75vh] max-w-full object-contain mx-auto" />
  ) : mime.startsWith('video/') ? (
    <video src={url} controls autoPlay className="max-h-[75vh] w-full bg-black" />
  ) : mime.startsWith('audio/') ? (
    <audio src={url} controls autoPlay className="w-full" />
  ) : (
    <iframe src={url} title={file.name} className="h-[75vh] w-full bg-white" sandbox="" />
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={file.name}>
      <div className="w-full max-w-5xl rounded-2xl bg-white shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-3">
          <p className="truncate text-sm font-semibold text-slate-800">{file.name}</p>
          <div className="flex items-center gap-3 text-sm">
            <a href={getDownloadUrl(file.id)} className="text-blue-600 hover:underline">Download</a>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Close">✕</button>
          </div>
        </div>
        <div className="bg-slate-50 p-4">{body}</div>
      </div>
    </div>
  );
}
