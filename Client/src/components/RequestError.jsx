export default function RequestError({ error, onRetry }) {
  if (!error) return null;
  return (
    <div role="alert" style={{ padding: '12px', marginBottom: '16px', border: '1px solid var(--danger)', borderRadius: 'var(--radius-sm)', color: 'var(--danger)' }}>
      <span>Could not load data. Check your connection and try again.</span>{' '}
      <button className="btn small" type="button" onClick={onRetry}>Retry</button>
    </div>
  );
}
