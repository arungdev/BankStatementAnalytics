import { FiEye, FiEyeOff } from 'react-icons/fi';

/** Eye button in the page header that hides/shows all monetary amounts
 *  (and, when enabled in Settings → Privacy, merchant/bill names too). */
export default function PrivacyToggle({ masked, onToggle }) {
  return (
    <button
      onClick={onToggle}
      aria-label={masked ? 'Turn off privacy mode' : 'Turn on privacy mode'}
      aria-pressed={masked}
      title={masked ? 'Turn off privacy mode' : 'Turn on privacy mode'}
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
