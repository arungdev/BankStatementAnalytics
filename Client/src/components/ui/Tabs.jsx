import './ui.css';

/**
 * Tabs — shared tab bar (replaces the per-page inline tab implementations).
 *
 * Props:
 *   tabs     — [{ key, label, count? }]
 *   active   — key of the active tab
 *   onChange — (key) => void
 *   variant  — 'pills' (default) | 'underline'
 */
export default function Tabs({ tabs = [], active, onChange, variant = 'pills' }) {
  return (
    <div className={`ui-tabs ui-tabs--${variant}`} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          aria-selected={active === tab.key}
          className={`ui-tab${active === tab.key ? ' active' : ''}`}
          onClick={() => onChange?.(tab.key)}
        >
          {tab.label}
          {tab.count != null && <span className="ui-tab-count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}
