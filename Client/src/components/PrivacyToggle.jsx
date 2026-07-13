import { FiEye, FiEyeOff } from 'react-icons/fi';

/** Eye button in the page header that hides/shows all monetary amounts. */
export default function PrivacyToggle({ masked, onToggle }) {
  return (
    <button
      onClick={onToggle}
      aria-label={masked ? 'Show amounts' : 'Hide amounts'}
      aria-pressed={masked}
      title={masked ? 'Show amounts' : 'Hide amounts'}
      className="btn icon"
      style={{
        borderRadius: '50%',
        width: '36px',
        height: '36px',
        color: 'var(--text-muted)',
        flexShrink: 0,
      }}
    >
      {masked ? <FiEyeOff size={17} /> : <FiEye size={17} />}
    </button>
  );
}
