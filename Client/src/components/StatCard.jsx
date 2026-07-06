/**
 * StatCard — dark KPI tile used across Trends / Insights (and any future
 * summary row). Kept as inline styles to match the design language already
 * established on Insights.
 */

const T = {
  cardDark:   '#1e1b4b',
  indigoSoft: '#a5b4fc',
  white:      '#ffffff',
  muted:      '#94a3b8',
};

export default function StatCard({ label, value, sub, accent, valueColor }) {
  return (
    <div style={{
      background: T.cardDark,
      borderRadius: '14px',
      padding: '20px 24px',
      flex: 1,
      minWidth: 0,
      boxShadow: '0 4px 20px rgba(79,70,229,0.15)',
    }}>
      <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: T.indigoSoft, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {label}
      </p>
      <p style={{ margin: '8px 0 4px', fontSize: '22px', fontWeight: 800, color: valueColor || T.white, letterSpacing: '-0.5px' }}>
        {value}
      </p>
      {sub && <p style={{ margin: 0, fontSize: '12px', color: accent || T.muted }}>{sub}</p>}
    </div>
  );
}
