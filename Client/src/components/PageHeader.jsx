import { FiSettings } from 'react-icons/fi';

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

const T = {
  border:  '#e5e7eb',
  text:    '#111827',
  muted:   '#6b7280',
  surface: '#ffffff',
  bg:      '#f8f9fb',
};

export default function PageHeader({
  title,
  subtitle,
  filters,          // ReactNode — shown in the second row; row hidden if absent
  actions,          // ReactNode — extra buttons beside the gear (left of gear)
  onSettings,       // () => void
}) {
  return (
    <header style={{
      background: T.surface,
      borderBottom: `1px solid ${T.border}`,
      position: 'relative',
      zIndex: 300,
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
            fontSize: '15px',
            fontWeight: 800,
            color: T.text,
            letterSpacing: '-0.3px',
            lineHeight: 1.2,
          }}>
            {title}
          </h2>
          {subtitle && (
            <span style={{ fontSize: '11px', color: T.muted, marginTop: '1px', lineHeight: 1.2 }}>
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
              style={{
                cursor: 'pointer',
                background: '#f3f4f6',
                border: '1px solid #d1d5db',
                borderRadius: '50%',
                width: '36px',
                height: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#374151',
                transition: 'background-color 0.2s',
                flexShrink: 0,
              }}
              onMouseOver={e => e.currentTarget.style.backgroundColor = '#e5e7eb'}
              onMouseOut={e  => e.currentTarget.style.backgroundColor = '#f3f4f6'}
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
          borderTop: `1px solid ${T.border}`,
          gap: '0',
          overflow: 'visible',
          position: 'relative',
          zIndex: 400,
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

const BORDER = `1px solid ${T.border}`;

/** Wraps a labelled group of controls inside the filter row */
export function FilterGroup({ label, children, style }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '7px',
      padding: '0 16px',
      height: '52px',
      borderRight: BORDER,
      flexShrink: 0,
      ...style,
    }}>
      {label && (
        <span style={{
          fontSize: '10px',
          fontWeight: 700,
          color: T.muted,
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
      padding: '0 16px',
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
            color: T.muted,
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
        transition: 'all 0.15s ease',
        background: active ? '#4f46e5' : '#eef2ff',
        color:      active ? '#ffffff' : '#7c3aed',
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
      borderColor: active ? '#4f46e5' : T.border,
      background:  active ? '#eef2ff' : 'transparent',
      fontSize: '11px', fontWeight: 700,
      color: active ? '#4f46e5' : T.muted,
      transition: 'all 0.15s',
      userSelect: 'none',
      whiteSpace: 'nowrap',
      flexShrink: 0,
    }}>
      <input type="checkbox" checked={active} onChange={onChange} style={{ display: 'none' }} />
      {dot !== false && (
        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: active ? '#4f46e5' : T.border, flexShrink: 0 }} />
      )}
      {children}
    </label>
  );
}