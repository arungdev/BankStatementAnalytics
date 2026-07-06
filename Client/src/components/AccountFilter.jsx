import { FilterGroup } from './PageHeader';

/**
 * Single-account selector for the shared page-header filter row. Used by pages that
 * read the globally-selected account (Transactions, Trends). Insights has its own
 * multi-account picker; Upload Statement has its own in-body dropdown.
 */
export default function AccountFilter({ accounts = [], value, onChange }) {
  const label = (acc) =>
    `${acc.accountHolderName || acc.bankName}` +
    `${acc.bankName && acc.accountHolderName ? ` · ${acc.bankName}` : ''}` +
    ` (${acc.accountNumber?.slice(-4) || '****'})`;

  return (
    <FilterGroup label="Account">
      <select
        value={value || ''}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={accounts.length === 0}
        style={{
          padding: '5px 8px',
          fontSize: '13px',
          fontWeight: 600,
          borderRadius: '6px',
          border: '1px solid var(--border-color)',
          background: 'var(--surface)',
          color: 'var(--text-main)',
          maxWidth: '240px',
          cursor: 'pointer',
        }}
      >
        {accounts.length === 0 && <option value="">No accounts</option>}
        {accounts.map((acc) => (
          <option key={acc.id} value={acc.id}>{label(acc)}</option>
        ))}
      </select>
    </FilterGroup>
  );
}
