import { useEffect } from 'react';
import './ui.css';

/**
 * Modal — shared centered dialog. Replaces the hand-rolled fixed overlays.
 *
 * Props:
 *   open      — render nothing when false
 *   onClose   — called on Escape, backdrop click, and the × button
 *   title     — optional heading (ReactNode)
 *   subtitle  — optional muted line under the title; also adds a header divider
 *               (matches the Settings modal header style)
 *   width     — panel width in px (default 420)
 *   footer    — optional ReactNode pinned under the body (action row)
 *   zIndex    — override stacking (e.g. 'var(--z-modal-top)' when the modal
 *               must sit above the Settings modal)
 *   children  — body content
 */
export default function Modal({ open, onClose, title, subtitle, width = 420, footer, zIndex, children }) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="ui-modal-backdrop" style={zIndex ? { zIndex } : undefined} onClick={onClose}>
      <div
        className="ui-modal"
        style={{ width }}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {(title || onClose) && (
          <div className={`ui-modal-header${subtitle ? ' with-sub' : ''}`}>
            <div className="ui-modal-header-text">
              {title && <h3 className="ui-modal-title">{title}</h3>}
              {subtitle && <p className="ui-modal-subtitle">{subtitle}</p>}
            </div>
            {onClose && (
              <button className="ui-modal-close" onClick={onClose} aria-label="Close" title="Close">
                ×
              </button>
            )}
          </div>
        )}
        <div className="ui-modal-body">{children}</div>
        {footer && <div className="ui-modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
