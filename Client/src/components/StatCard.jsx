/**
 * StatCard — branded KPI tile used across Overview / Trends / Insights /
 * Budgets / Investments. The tile stays dark in both themes (a deliberate
 * brand element); its surface comes from the --stat-tile-* tokens so the
 * dark theme can add a border and adjust the gradient.
 */

export default function StatCard({ label, value, sub, accent, valueColor, onClick, active = false, title }) {
  // Full INR amounts (e.g. "-₹10,04,845.65") can outgrow the tile at narrow
  // widths; step the font down by length so the value never clips or wraps.
  const len = String(value ?? '').length;
  const valueSize = len >= 16 ? '15px' : len >= 14 ? '17px' : len >= 11 ? '19px' : '22px';

  // Clickable tiles (drill-downs) get a button role, a pointer, and a ring while
  // their panel is open; plain tiles render exactly as before.
  const clickable = typeof onClick === 'function';
  return (
    <div
      className={clickable ? 'stat-card is-clickable' : 'stat-card'}
      onClick={onClick}
      onKeyDown={clickable ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); }
      } : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={title}
      aria-pressed={clickable ? active : undefined}
      style={{
      background: 'var(--stat-tile-bg)',
      border: '1px solid var(--stat-tile-border)',
      borderRadius: '14px',
      padding: '20px 24px',
      flex: 1,
      minWidth: '190px',
      boxShadow: active
        ? '0 4px 20px rgba(79,70,229,0.15), 0 0 0 2px var(--primary)'
        : '0 4px 20px rgba(79,70,229,0.15)',
      cursor: clickable ? 'pointer' : undefined,
      transition: 'transform 0.12s ease, box-shadow 0.12s ease',
    }}>
      <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: 'var(--stat-tile-label)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {label}
      </p>
      <p style={{ margin: '8px 0 4px', fontSize: valueSize, fontWeight: 800, color: valueColor || 'var(--stat-tile-value)', letterSpacing: '-0.5px', whiteSpace: 'nowrap' }}>
        {value}
      </p>
      {sub && <p style={{ margin: 0, fontSize: '12px', color: accent || '#94a3b8' }}>{sub}</p>}
    </div>
  );
}
