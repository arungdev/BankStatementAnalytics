import { Link } from 'react-router-dom';
import { usePrivacy } from '../context/usePrivacy';

export default function ImportWarnings({ warnings = [], uploadId, accountId }) {
  const { maskAmounts } = usePrivacy();
  if (!warnings.length) return null;
  return (
    <details open style={{ margin: '12px 0', padding: '12px', border: '1px solid var(--warning, #d97706)', borderRadius: 'var(--radius-sm)' }}>
      <summary>Review import warnings ({warnings.length})</summary>
      <ul>{warnings.map((warning, index) => <li key={index}>{maskAmounts ? 'Import warning found. Turn off amount masking to inspect the details.' : warning}</li>)}</ul>
      {uploadId && <Link to={`/transactions?uploadId=${encodeURIComponent(uploadId)}&accountId=${encodeURIComponent(accountId)}`}>Review imported transactions</Link>}
    </details>
  );
}
