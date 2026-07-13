import './ui.css';

/**
 * EmptyState — the canonical "nothing to show" placeholder.
 *
 * Props: { icon, title, message, subtitle (alias of message), action, compact }
 * `icon` can be an emoji string or a react-icons element; it renders inside
 * a round badge.
 */
export default function EmptyState({ icon, title, message, subtitle, action, compact = false }) {
  const text = message ?? subtitle;
  return (
    <div className={`ui-empty-state${compact ? ' compact' : ''}`}>
      {icon && <div className="ui-empty-icon">{icon}</div>}
      {title && <p className="ui-empty-title">{title}</p>}
      {text && <span className="ui-empty-message">{text}</span>}
      {action}
    </div>
  );
}
