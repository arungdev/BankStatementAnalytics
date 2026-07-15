import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FiCheck, FiChevronDown } from 'react-icons/fi';

const MENU_MAX_HEIGHT = 240;
const MENU_GAP = 6;

/**
 * Custom select for modal/settings forms — replaces native <select> so the
 * open menu matches the app's dropdown styling (rounded, themed, scrollable)
 * instead of the browser default. Options are `{ value, label }`.
 *
 * The menu is position:fixed and placed from the trigger's rect so it isn't
 * clipped by scrolling ancestors (e.g. `.ui-modal-body`); it flips upward
 * when there isn't enough room below the trigger.
 *
 * Keyboard: ArrowUp/Down move the highlight, Enter/Space pick it, Escape closes.
 */
export default function Select({
  options = [],
  value,
  onChange,
  placeholder = 'Select…',
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [pos, setPos] = useState(null);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const selected = options.find((o) => o.value === value);

  // Place the menu under (or above) the trigger in viewport coordinates.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP;
    const flipUp = spaceBelow < 160 && rect.top > spaceBelow;
    const maxHeight = Math.min(
      MENU_MAX_HEIGHT,
      (flipUp ? rect.top : spaceBelow) - MENU_GAP,
    );
    setPos({
      left: rect.left,
      width: rect.width,
      maxHeight,
      ...(flipUp
        ? { bottom: window.innerHeight - rect.top + MENU_GAP }
        : { top: rect.bottom + MENU_GAP }),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    // A fixed-position menu goes stale if the page behind it moves; scrolling
    // inside the menu itself is fine.
    const onScroll = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  // Keep the highlighted option visible while navigating with the keyboard.
  useEffect(() => {
    if (!open || highlight < 0) return;
    menuRef.current
      ?.children[highlight]
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, highlight]);

  const toggle = () => {
    if (disabled) return;
    setOpen((o) => {
      if (!o) setHighlight(options.findIndex((opt) => opt.value === value));
      return !o;
    });
  };

  const pick = (opt) => {
    onChange(opt.value);
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (disabled) return;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        toggle();
      }
      return;
    }
    if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (highlight >= 0 && highlight < options.length) pick(options[highlight]);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="ui-select">
      <button
        ref={triggerRef}
        type="button"
        className={`ui-select-trigger${open ? ' open' : ''}`}
        onClick={toggle}
        onKeyDown={onKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`ui-select-value${selected ? '' : ' placeholder'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <FiChevronDown size={15} className="ui-select-caret" />
      </button>

      {open && pos && (
        <div
          ref={menuRef}
          className="ui-select-menu"
          role="listbox"
          style={pos}
        >
          {options.length === 0 && (
            <div className="ui-select-empty">No options</div>
          )}
          {options.map((opt, i) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                className={
                  `ui-select-option${active ? ' active' : ''}${i === highlight ? ' highlight' : ''}`
                }
                onClick={() => pick(opt)}
                onMouseEnter={() => setHighlight(i)}
                role="option"
                aria-selected={active}
              >
                <span className="ui-select-option-label">{opt.label}</span>
                {active && <FiCheck size={14} style={{ flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
