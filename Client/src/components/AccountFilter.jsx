import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
 * Account selector — a self-labeled "chip" (muted Account prefix + value +
 * caret) opening a custom dropdown so it matches the DateRangePicker trigger.
 * Reads the globally selected account.
 *
 * Rendered once per app in the PageHeader title row (see Layout in App.jsx),
 * where it acts as the global account scope rather than a per-page filter.
 * `align="right"` flips the menu to hang off the chip's right edge, which is
 * what that top-right placement needs; the default hangs off the left.
 *
 * Includes an "All accounts" option so analytics pages can aggregate across
 * every account — pass `includeAll={false}` for a placement that only works
 * one account at a time.
 *
 * When there are no accounts yet, renders an "Add account" button (via `onAdd`)
 * that opens the account creation modal directly instead of a dead select.
 *
 * The menu is portalled to `document.body` and positioned from the trigger's
 * rect (same trick as `Select` in @common/client). It has to be: PageHeader
 * gives the header `z-index: var(--z-header)`, which opens a stacking context,
 * so an in-flow menu is capped at 100 no matter what `--z-dropdown` says and
 * disappears behind any open right-hand drawer (`--z-drawer`) — which is
 * exactly where this chip sits.
 */
export default function AccountFilter({ accounts = [], value, onChange, includeAll = true, onAdd, align = 'left' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    // The menu lives outside `ref`'s subtree, so test both before dismissing.
    const onDown = (e) => {
      if (ref.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Keep the fixed-position menu pinned to the trigger while it's open.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      setPos(align === 'right'
        ? { top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) }
        : { top: r.bottom + 6, left: Math.max(8, r.left) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, align]);

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

  const pick = (v) => {
    onChange(v === ALL_ACCOUNTS ? ALL_ACCOUNTS : Number(v));
    setOpen(false);
  };

  // When "All accounts" isn't offered here (e.g. Transactions) but is the active
  // global selection, show a placeholder instead of a misleading account name.
  const isAll = value === ALL_ACCOUNTS;
  const showAllPlaceholder = isAll && !includeAll;
  const selected = accounts.find((a) => a.id === value);

  // Trigger content — a real account renders like a compact dropdown option
  // (bank monogram avatar + holder name + masked last-4) so nothing gets
  // truncated mid-number; the aggregate/placeholder states stay text-only.
  let trigger;
  if (showAllPlaceholder) {
    trigger = (
      <>
        <FiCreditCard size={14} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
        <span className="filter-chip-prefix">Account</span>
        <span>Select an account…</span>
      </>
    );
  } else if (isAll) {
    trigger = (
      <>
        <span className="filter-chip-avatar" style={{ width: 22, height: 22 }}>
          <FiLayers size={12} />
        </span>
        <span>All accounts</span>
      </>
    );
  } else if (selected) {
    trigger = (
      <>
        <span className="filter-chip-avatar" style={{ width: 22, height: 22 }}>
          {monogram(selected.bankName)}
        </span>
        <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {selected.accountHolderName || selected.bankName}
        </span>
        <span className="filter-chip-prefix" style={{ flexShrink: 0 }}>•••• {last4(selected)}</span>
      </>
    );
  } else {
    trigger = (
      <>
        <FiCreditCard size={14} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
        <span className="filter-chip-prefix">Account</span>
        <span>No accounts</span>
      </>
    );
  }

  const menu = open && pos && createPortal(
    <div
      ref={menuRef}
      className="filter-chip-menu floating"
      role="listbox"
      style={pos}
    >
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
    </div>,
    document.body,
  );

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
          {trigger}
          <FiChevronDown size={13} className="filter-chip-caret" />
        </button>
      </div>
      {menu}
    </FilterGroup>
  );
}
