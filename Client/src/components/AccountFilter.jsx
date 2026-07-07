import { FilterGroup } from './PageHeader';

/**
 * Sentinel value for the "All accounts" selection. Pages that aggregate across
 * accounts (Overview, Trends, Insights) treat this as "every owned account";
 * single-account pages (Transactions, Upload) guard against it.
 */
export const ALL_ACCOUNTS = 'all';

/**
 * Account selector for the shared page-header filter row. Reads the globally
 * selected account. Includes an "All accounts" option so analytics pages can
 * aggregate across every account — pass `includeAll={false}` on pages that
 * only work one account at a time (e.g. Transactions).
 */
export default function AccountFilter({ accounts = [], value, onChange, includeAll = true }) {
  const label = (acc) =>
    `${acc.accountHolderName || acc.bankName}` +
    `${acc.bankName && acc.accountHolderName ? ` · ${acc.bankName}` : ''}` +
    ` (${acc.accountNumber?.slice(-4) || '****'})`;

  const handleChange = (e) => {
    const v = e.target.value;
    onChange(v === ALL_ACCOUNTS ? ALL_ACCOUNTS : Number(v));
  };

  // When "All accounts" isn't offered here (e.g. Transactions) but is the active
  // global selection, the value has no matching <option>. Show a placeholder
  // instead of letting the native select silently fall back to the first option.
  const isAll = value === ALL_ACCOUNTS;
  const showAllPlaceholder = isAll && !includeAll;
  const selectValue = showAllPlaceholder ? '' : (value ?? '');

  return (
    <FilterGroup label="Account">
      <select
        value={selectValue}
        onChange={handleChange}
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
        {showAllPlaceholder && <option value="" disabled>Select an account…</option>}
        {includeAll && accounts.length > 0 && <option value={ALL_ACCOUNTS}>All accounts</option>}
        {accounts.map((acc) => (
          <option key={acc.id} value={acc.id}>{label(acc)}</option>
        ))}
      </select>
    </FilterGroup>
  );
}
