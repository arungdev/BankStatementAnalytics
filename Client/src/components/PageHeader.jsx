import { Fragment, useEffect, useRef, useState } from 'react';
import { FiSettings, FiChevronDown, FiCheck } from 'react-icons/fi';
import './filter-chip.css';

/**
 * PageHeader — reusable two-row header
 *
 * Row 1: title (left) + actions slot (right, e.g. gear button)
 * Row 2: filters slot (optional — omitted entirely if not provided)
 *
 * Usage:
 *   <PageHeader
 *     title="Spending Insights"
 *     subtitle="Where your money goes"
 *     actions={<button>...</button>}
 *     filters={<InsightsFilters ... />}
 *     onSettings={() => setOpen(true)}
 *   />
 */

export default function PageHeader({
  title,
  subtitle,
  filters,          // ReactNode — shown in the second row; row hidden if absent
  actions,          // ReactNode — extra buttons beside the gear (left of gear)
  onSettings,       // () => void
}) {
  const headerRef = useRef(null);

  // Publish the header's rendered height so overlays (the right-hand detail
  // drawer) can sit below it instead of covering the top-right controls.
  // Height is dynamic — the filters row is only present on some pages.
  // --app-titlebar-h is row 1 alone, for panels that dock beside the filter row.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const setVar = () => {
      document.documentElement.style.setProperty('--app-header-h', `${el.offsetHeight}px`);
      const titleRow = el.firstElementChild;
      if (titleRow)
        document.documentElement.style.setProperty('--app-titlebar-h', `${titleRow.offsetHeight}px`);
    };
    setVar();
    const ro = new ResizeObserver(setVar);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty('--app-header-h');
      document.documentElement.style.removeProperty('--app-titlebar-h');
    };
  }, [filters]);

  return (
    <header ref={headerRef} style={{
      background: 'var(--surface)',
      borderBottom: '1px solid var(--border-color)',
      position: 'relative',
      zIndex: 'var(--z-header)',
      overflow: 'visible',
    }}>

      {/* ── Row 1: title + right actions ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px 0 24px',
        minHeight: '52px',
        gap: '12px',
      }}>
        {/* Title */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <h2 style={{
            margin: 0,
            fontSize: '16px',
            fontWeight: 700,
            color: 'var(--text-main)',
            letterSpacing: '-0.01em',
            lineHeight: 1.2,
          }}>
            {title}
          </h2>
          {subtitle && (
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '1px', lineHeight: 1.2 }}>
              {subtitle}
            </span>
          )}
        </div>

        {/* Right side: custom actions + gear */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {actions}
          {onSettings && (
            <button
              onClick={onSettings}
              className="btn icon"
              style={{ borderRadius: '50%', width: '36px', height: '36px', color: 'var(--text-muted)' }}
              title="Settings"
            >
              <FiSettings size={17} />
            </button>
          )}
        </div>
      </div>

      {/* ── Row 2: filters (only rendered when provided) ── */}
      {filters && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px',
          minHeight: '52px',
          borderTop: '1px solid var(--border-color)',
          gap: '18px',
          overflow: 'visible',
          position: 'relative',
          zIndex: 1,
        }}>
          {filters}
        </div>
      )}
    </header>
  );
}


/* ─────────────────────────────────────────────────────────────────────────
   Filter primitives — import these on any page to build a filter row

   <FilterBar>                     outer wrapper (handles dividers between children)
     <FilterGroup label="Group by"> ... </FilterGroup>
     <FilterGroup label="Period">   ... </FilterGroup>
   </FilterBar>
───────────────────────────────────────────────────────────────────────── */

/** Wraps a (optionally labelled) group of controls inside the filter row.
    Chip-style controls (AccountFilter, DateRangePicker) label themselves, so
    omit `label` for those — groups are separated by the row's gap, not dividers. */
export function FilterGroup({ label, children, style }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '7px',
      height: '52px',
      flexShrink: 0,
      ...style,
    }}>
      {label && (
        <span style={{
          fontSize: '10px',
          fontWeight: 700,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          whiteSpace: 'nowrap',
        }}>
          {label}
        </span>
      )}
      {children}
    </div>
  );
}

/** Scrollable last group — use for account chips or anything that can overflow */
export function FilterGroupScroll({ label, children }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      flex: 1,
      minWidth: 0,
      height: '52px',
      overflowX: 'auto',
      overflowY: 'visible',
      scrollbarWidth: 'none',
    }}>
      <style>{`.ph-scroll::-webkit-scrollbar{display:none}`}</style>
      <div className="ph-scroll" style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'nowrap' }}>
        {label && (
          <span style={{
            fontSize: '10px',
            fontWeight: 700,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            whiteSpace: 'nowrap',
            marginRight: '2px',
          }}>
            {label}
          </span>
        )}
        {children}
      </div>
    </div>
  );
}

/** Pill toggle button — use inside FilterGroup */
export function FilterPill({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 12px',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        fontSize: '12px',
        fontWeight: 700,
        fontFamily: 'inherit',
        transition: 'all 0.15s ease',
        background: active ? 'var(--primary)' : 'var(--gray-100)',
        color:      active ? '#ffffff' : 'var(--text-muted)',
        boxShadow:  active ? '0 2px 6px rgba(79,70,229,0.3)' : 'none',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

/** Account / tag chip toggle — use inside FilterGroupScroll */
export function FilterChip({ active, onChange, dot, children }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: '4px',
      cursor: 'pointer', padding: '3px 9px', borderRadius: '6px',
      border: '1.5px solid',
      borderColor: active ? 'var(--primary)' : 'var(--border-color)',
      background:  active ? 'var(--primary-light)' : 'transparent',
      fontSize: '11px', fontWeight: 700,
      color: active ? 'var(--primary)' : 'var(--text-muted)',
      transition: 'all 0.15s',
      userSelect: 'none',
      whiteSpace: 'nowrap',
      flexShrink: 0,
    }}>
      <input type="checkbox" checked={active} onChange={onChange} style={{ display: 'none' }} />
      {dot !== false && (
        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: active ? 'var(--primary)' : 'var(--border-color)', flexShrink: 0 }} />
      )}
      {children}
    </label>
  );
}

/** Chip-styled custom dropdown — replaces a native <select> so the open menu
    matches AccountFilter / DateRangePicker (surface, radius, check on active)
    instead of the browser's stock popup.

    options: [{ value, label, menuLabel?, group? }]
      label     — shown in the trigger when selected (e.g. "June 2026")
      menuLabel — optional shorter text for the menu row (e.g. "June")
      group     — optional section header; consecutive options sharing a group
                  render under one uppercase header (e.g. the year) */
export function FilterDropdownChip({
  prefix,
  icon,
  value,
  options = [],
  onSelect,
  placeholder = 'No data',
  disabled,
  menuWidth = 190,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const activeRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Keep the current selection visible when the menu opens.
  useEffect(() => {
    if (open) activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  // Roving focus: ↑/↓ move through the option buttons from the trigger or menu.
  const onKeyNav = (e) => {
    if (!open || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll('.filter-chip-option') ?? [])];
    if (items.length === 0) return;
    const idx = items.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown'
      ? (idx < 0 ? 0 : Math.min(idx + 1, items.length - 1))
      : (idx < 0 ? items.length - 1 : Math.max(idx - 1, 0));
    items[next].focus();
  };

  const selected = options.find(o => o.value === value);

  return (
    <div ref={ref} style={{ position: 'relative' }} onKeyDown={onKeyNav}>
      <button
        className={`filter-chip${open ? ' open' : ''}`}
        onClick={() => setOpen(o => !o)}
        disabled={disabled || options.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {icon}
        {prefix && <span className="filter-chip-prefix">{prefix}</span>}
        <span style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {selected?.label ?? placeholder}
        </span>
        <FiChevronDown size={13} className="filter-chip-caret" />
      </button>

      {open && (
        <div className="filter-chip-menu" role="listbox" style={{ minWidth: menuWidth }}>
          {options.map((o, i) => {
            const active = o.value === value;
            const showHeader = o.group && o.group !== options[i - 1]?.group;
            return (
              <Fragment key={o.value}>
                {showHeader && <div className="filter-chip-group">{o.group}</div>}
                <button
                  ref={active ? activeRef : undefined}
                  className={`filter-chip-option${active ? ' active' : ''}`}
                  onClick={() => { onSelect(o.value); setOpen(false); }}
                  role="option"
                  aria-selected={active}
                >
                  <span style={{ flex: 1 }}>{o.menuLabel ?? o.label}</span>
                  {active && <FiCheck size={14} style={{ flexShrink: 0 }} />}
                </button>
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
