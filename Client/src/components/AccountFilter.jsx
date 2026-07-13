import { useEffect, useRef, useState } from 'react';
import { FiPlus, FiCheck, FiChevronDown, FiCreditCard, FiLayers } from 'react-icons/fi';
import { FilterGroup } from './PageHeader';

/**
 * Sentinel value for the "All accounts" selection. Pages that aggregate across
 * accounts (Overview, Trends, Insights) treat this as "every owned account";
 * single-account pages (Transactions, Upload) guard against it.
 */
export const ALL_ACCOUNTS = 'all';

/** Short bank monogram for the option avatar — "HDFC Bank" → "HB", "IOB" → "IOB" */
const monogram = (name = '') => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return words.map(w => w[0]).slice(0, 3).join('').toUpperCase();
  return (words[0] || '?').slice(0, 3).toUpperCase();
};

const last4 = (acc) => acc.accountNumber?.slice(-4) || '****';

/**
 * Account selector for the shared page-header filter row — a self-labeled
 * "chip" (muted Account prefix + value + caret) opening a custom dropdown so
 * it matches the DateRangePicker trigger. Reads the globally selected account.
 * Includes an "All accounts" option so analytics pages can aggregate across
 * every account — pass `includeAll={false}` on pages that only work one
 * account at a time (e.g. Transactions).
 *
 * When there are no accounts yet, renders an "Add account" button (via `onAdd`)
 * that takes the user to the accounts page in Settings instead of a dead select.
 */
export default function AccountFilter({ accounts = [], value, onChange, includeAll = true, onAdd }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // No accounts linked yet — offer a shortcut to add one rather than a dead control.
  if (accounts.length === 0 && onAdd) {
    return (
      <FilterGroup>
        <button
          onClick={onAdd}
          className="btn filter-chip"
          style={{
            border: '1px solid var(--primary)',
            background: 'var(--primary-light)',
            color: 'var(--primary)',
          }}
          title="Add a bank account"
        >
          <FiPlus size={15} /> Add account
        </button>
      </FilterGroup>
    );
  }

  const label = (acc) =>
    `${acc.accountHolderName || acc.bankName}` +
    `${acc.bankName && acc.accountHolderName ? ` · ${acc.bankName}` : ''}` +
    ` (${last4(acc)})`;

  const pick = (v) => {
    onChange(v === ALL_ACCOUNTS ? ALL_ACCOUNTS : Number(v));
    setOpen(false);
  };

  // When "All accounts" isn't offered here (e.g. Transactions) but is the active
  // global selection, show a placeholder instead of a misleading account name.
  const isAll = value === ALL_ACCOUNTS;
  const showAllPlaceholder = isAll && !includeAll;
  const selected = accounts.find((a) => a.id === value);
  const display = showAllPlaceholder
    ? 'Select an account…'
    : isAll
      ? 'All accounts'
      : selected ? label(selected) : 'No accounts';

  return (
    <FilterGroup style={{ position: 'relative', zIndex: 'var(--z-dropdown)' }}>
      <div ref={ref} style={{ position: 'relative' }}>
        <button
          className={`filter-chip${open ? ' open' : ''}`}
          onClick={() => setOpen((o) => !o)}
          disabled={accounts.length === 0}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <FiCreditCard size={14} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
          <span className="filter-chip-prefix">Account</span>
          <span style={{ maxWidth: 210, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {display}
          </span>
          <FiChevronDown size={13} className="filter-chip-caret" />
        </button>

        {open && (
          <div className="filter-chip-menu" role="listbox">
            {includeAll && (
              <button
                className={`filter-chip-option${isAll ? ' active' : ''}`}
                onClick={() => pick(ALL_ACCOUNTS)}
                role="option"
                aria-selected={isAll}
              >
                <span className="filter-chip-avatar"><FiLayers size={12} /></span>
                <span style={{ flex: 1 }}>All accounts</span>
                {isAll && <FiCheck size={14} style={{ flexShrink: 0 }} />}
              </button>
            )}
            {accounts.map((acc) => {
              const active = acc.id === value;
              return (
                <button
                  key={acc.id}
                  className={`filter-chip-option${active ? ' active' : ''}`}
                  onClick={() => pick(acc.id)}
                  role="option"
                  aria-selected={active}
                >
                  <span className="filter-chip-avatar">{monogram(acc.bankName)}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {acc.accountHolderName || acc.bankName}
                    </span>
                    <span className="filter-chip-option-sub">
                      {acc.bankName} · •••• {last4(acc)}
                    </span>
                  </span>
                  {active && <FiCheck size={14} style={{ color: 'var(--primary)', flexShrink: 0 }} />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </FilterGroup>
  );
}
