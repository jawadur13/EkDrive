import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import { Modal } from './Modal';

interface Entry {
  id: string;
  name: string;
  is_folder: boolean;
}

/**
 * Picks a destination by walking the folder tree. A dialog rather than drag-and-drop: it works
 * the same with a keyboard, on a phone, and when the target folder is nowhere near on screen.
 */
export function MoveDialog({
  item,
  currentParentId,
  onCancel,
  onMove,
}: {
  item: { id: string; name: string; is_folder: boolean };
  currentParentId: string | null;
  onCancel: () => void;
  onMove: (destinationId: string | null) => void;
}) {
  const [folderId, setFolderId] = useState<string | null>(currentParentId);
  const [trail, setTrail] = useState<Array<{ id: string | null; name: string }>>([{ id: null, name: 'Files' }]);

  const { data, isLoading } = useQuery({
    queryKey: ['move-browse', folderId],
    queryFn: () =>
      api
        .get('/files', { params: { parentFolderId: folderId ?? undefined, limit: 200 } })
        .then((r) => (r.data.files as Entry[]).filter((f) => f.is_folder && f.id !== item.id)),
  });

  const open = (folder: Entry) => {
    setFolderId(folder.id);
    setTrail((t) => [...t, { id: folder.id, name: folder.name }]);
  };

  const goTo = (index: number) => {
    setTrail((t) => t.slice(0, index + 1));
    setFolderId(trail[index].id);
  };

  const unchanged = folderId === currentParentId;

  return (
    <Modal label={`Move ${item.name}`} onClose={onCancel}>
      <div className="border-b border-slate-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-800">Move “{item.name}”</h2>
        <nav className="mt-1 flex flex-wrap items-center gap-1 text-xs text-slate-500" aria-label="Destination path">
          {trail.map((crumb, i) => (
            <span key={crumb.id ?? 'root'} className="flex items-center gap-1">
              {i > 0 && <span className="text-slate-300">/</span>}
              <button
                className={i === trail.length - 1 ? 'font-medium text-slate-700' : 'hover:text-blue-600'}
                onClick={() => goTo(i)}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </nav>
      </div>

      <div className="max-h-72 overflow-y-auto px-2 py-2">
        {isLoading ? (
          <div className="skeleton m-3 h-8" />
        ) : data && data.length > 0 ? (
          <ul>
            {data.map((folder) => (
              <li key={folder.id}>
                <button
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                  onClick={() => open(folder)}
                >
                  <span aria-hidden="true">📁</span>
                  <span className="truncate">{folder.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-6 text-center text-sm text-slate-400">No folders here.</p>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3">
        <p className="text-xs text-slate-500">
          {unchanged ? 'This is where it already is.' : `Moving into ${trail[trail.length - 1].name}`}
        </p>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary" disabled={unchanged} onClick={() => onMove(folderId)}>
            Move here
          </button>
        </div>
      </div>
    </Modal>
  );
}
