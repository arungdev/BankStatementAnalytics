import './ui.css';

export default function EmptyState({ icon, title, message, action }) {
  return (
    <div className="ui-empty-state">
      {icon && <div className="ui-empty-icon">{icon}</div>}
      {title && <p className="ui-empty-title">{title}</p>}
      {message && <span className="ui-empty-message">{message}</span>}
      {action}
    </div>
  );
}
