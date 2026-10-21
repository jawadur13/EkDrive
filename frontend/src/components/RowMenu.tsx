import { useEffect, useRef, useState } from 'react';

export type RowAction = {
  label: string;
  onSelect?: () => void;
  /** Renders as a link instead of a button, for a plain download URL. */
  href?: string;
  danger?: boolean;
};

/**
 * The per-row actions behind one button. A row has five or six of them, which do not fit on a
 * phone and are noise on a desktop; this keeps them one click away and reachable by keyboard.
 */
export function RowMenu({ label, actions }: { label: string; actions: RowAction[] }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const itemClass = (danger?: boolean) =>
    `block w-full px-4 py-2 text-left text-sm ${danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50'}`;

  return (
    <div className="relative inline-block text-left" ref={container}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        aria-label={`Actions for ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <circle cx="4" cy="10" r="1.5" />
          <circle cx="10" cy="10" r="1.5" />
          <circle cx="16" cy="10" r="1.5" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-44 overflow-hidden rounded-xl border border-slate-100 bg-white py-1 shadow-lg"
        >
          {actions.map((action) =>
            action.href ? (
              <a key={action.label} role="menuitem" href={action.href} className={itemClass()} onClick={() => setOpen(false)}>
                {action.label}
              </a>
            ) : (
              <button
                key={action.label}
                role="menuitem"
                className={itemClass(action.danger)}
                onClick={() => {
                  setOpen(false);
                  action.onSelect?.();
                }}
              >
                {action.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
