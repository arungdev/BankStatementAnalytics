import { useEffect, useRef, useState } from 'react';
import './ui.css';

// All drawers dock to the same right edge, so only one may be open at a time —
// opening any drawer broadcasts this event and every other open drawer closes.
const OPEN_EVENT = 'ui-drawer-open';
let drawerSeq = 0;

/**
 * Slide-in right-hand detail panel shell — header, close button, optional
 * drag-to-resize handle. Used for transaction/merchant detail views.
 * Mutually exclusive: opening one drawer closes any other open drawer.
 *
 * modal (default true): renders a full-screen backdrop that dims the page and
 * closes the drawer on outside-click. Pass modal={false} for a docked, non-blocking
 * panel — the page behind stays fully interactive (pair it with a marginRight on the
 * page content so the drawer sits beside it rather than over it).
 *
 * Positioning lives in ui.css: the panel starts beside the page's filter row
 * (below the title row, --app-titlebar-h) and its header bar ends flush with
 * the page header's bottom border.
 */
export default function Drawer({ open, onClose, title, children, width = 450, onWidthChange, minWidth = 300, modal = true }) {
  const [isResizing, setIsResizing] = useState(false);

  const [drawerId] = useState(() => ++drawerSeq);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    // Announce first, then listen — the announcement closes other drawers and
    // isn't heard by this one (its listener isn't registered yet).
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: drawerId }));
    const closeIfOther = (e) => {
      if (e.detail !== drawerId) onCloseRef.current?.();
    };
    window.addEventListener(OPEN_EVENT, closeIfOther);
    return () => window.removeEventListener(OPEN_EVENT, closeIfOther);
  }, [open, drawerId]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e) => {
      const newWidth = window.innerWidth - e.clientX;
      if (newWidth >= minWidth && newWidth <= window.innerWidth - 50) {
        onWidthChange?.(newWidth);
      }
    };
    const handleMouseUp = () => setIsResizing(false);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
    };
  }, [isResizing, minWidth, onWidthChange]);

  if (!open) return null;

  return (
    <>
      {modal && <div className="ui-drawer-backdrop" onClick={onClose} />}
      <div className="ui-drawer" style={{ width: `${width}px` }}>
        {onWidthChange && (
          <div
            className="ui-drawer-resize-handle"
            onMouseDown={() => setIsResizing(true)}
            style={{ backgroundColor: isResizing ? 'var(--primary)' : 'transparent' }}
          />
        )}
        <div className="ui-drawer-header">
          <h2>{title}</h2>
          <button className="ui-drawer-close" onClick={onClose}>&times;</button>
        </div>
        <div className="ui-drawer-body">
          {children}
        </div>
      </div>
    </>
  );
}
