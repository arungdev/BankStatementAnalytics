/**
 * EmptyState — shared "nothing to show" placeholder (icon badge + title +
 * subtitle) used inside charts, cards, and drill-down panels.
 */

export default function EmptyState({ icon = '📊', title, subtitle, compact = false }) {
  const iconSize = compact ? 44 : 56;
  const iconFont = compact ? 20 : 24;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      gap: 10,
      padding: compact ? '32px 20px' : '48px 24px',
    }}>
      <div style={{
        width: iconSize,
        height: iconSize,
        borderRadius: '50%',
        background: '#f3f4f6',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: iconFont,
        flexShrink: 0,
      }}>
        {icon}
      </div>
      <div>
        <p style={{ margin: 0, fontWeight: 700, fontSize: compact ? 14 : 15, color: '#111827' }}>{title}</p>
        {subtitle && (
          <p style={{ margin: '4px 0 0', fontSize: compact ? 12 : 13, color: '#6b7280', maxWidth: 320 }}>{subtitle}</p>
        )}
      </div>
    </div>
  );
}
