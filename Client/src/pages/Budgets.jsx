import { useState, useEffect, useCallback } from 'react';
import { FiPlus, FiEdit2, FiTrash2, FiCalendar, FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import api from '../api/client';
import StatCard from '../components/StatCard';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import { currencyFormatter as fmt } from '../utils/format';
import { usePrivacy } from '../context/usePrivacy';

// Meter colour by burn-down: comfortable → warning → over.
const meterColor = (percent, over) =>
  over || percent >= 100 ? 'var(--danger)' : percent >= 80 ? 'var(--warning)' : 'var(--success)';

const s = {
  page: {
    padding: '28px 32px',
    background: 'var(--bg)',
    minHeight: '100vh',
  },
  statsRow: { display: 'flex', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' },
  headRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: '16px', gap: '12px', flexWrap: 'wrap',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: '16px',
  },
  card: {
    background: 'var(--surface)', borderRadius: '14px',
    padding: '20px 22px', border: '1px solid var(--border-color)',
    boxShadow: 'var(--shadow-sm)',
  },
  iconBtn: {
    background: 'var(--gray-100)', border: '1px solid var(--border-color)', borderRadius: '6px',
    width: '30px', height: '30px', display: 'flex', alignItems: 'center',
    justifyContent: 'center', cursor: 'pointer', color: 'var(--text-muted)',
  },
  label: { display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' },
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ─── MonthPicker — calendar-style month/year selector ──────────────────────
 * Works in "months ago" units (0 = current month). Only months within the
 * available range [0, maxAgo] are selectable; maxAgo comes from the real
 * transaction history (see /budgets/months). */
function MonthPicker({ monthsAgo, setMonthsAgo, maxAgo }) {
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth(); // 0-11

  const agoToYM = (ago) => {
    const total = curY * 12 + curM - ago;
    return { y: Math.floor(total / 12), m: total % 12 };
  };
  const ymToAgo = (y, m) => (curY * 12 + curM) - (y * 12 + m);

  const sel = agoToYM(monthsAgo);
  const earliest = agoToYM(maxAgo); // oldest selectable month

  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(sel.y);

  // Open the popover on the selected month's year.
  const toggle = () => { setViewYear(sel.y); setOpen((o) => !o); };

  const selLabel = new Date(sel.y, sel.m, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  const canPrevYear = viewYear > earliest.y;
  const canNextYear = viewYear < curY;

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={toggle}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '8px',
          background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '8px',
          padding: '7px 12px', fontSize: '13px', fontWeight: 700, color: 'var(--text-main)',
          cursor: 'pointer', minWidth: '150px', justifyContent: 'space-between',
          fontFamily: 'inherit',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <FiCalendar size={14} style={{ color: 'var(--text-muted)' }} /> {selLabel}
        </span>
        <FiChevronRight size={14} style={{ color: 'var(--text-faint)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 'calc(var(--z-dropdown) - 1)' }} />
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 'var(--z-dropdown)',
            background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: '12px',
            boxShadow: 'var(--shadow-lg)', padding: '14px', width: '260px',
          }}>
            {/* Year nav */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <button
                onClick={() => canPrevYear && setViewYear((y) => y - 1)}
                disabled={!canPrevYear}
                style={{ ...navBtn, opacity: canPrevYear ? 1 : 0.3, cursor: canPrevYear ? 'pointer' : 'default' }}
              >
                <FiChevronLeft size={16} />
              </button>
              <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-main)' }}>{viewYear}</span>
              <button
                onClick={() => canNextYear && setViewYear((y) => y + 1)}
                disabled={!canNextYear}
                style={{ ...navBtn, opacity: canNextYear ? 1 : 0.3, cursor: canNextYear ? 'pointer' : 'default' }}
              >
                <FiChevronRight size={16} />
              </button>
            </div>

            {/* Month grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
              {MONTHS.map((label, m) => {
                const ago = ymToAgo(viewYear, m);
                const enabled = ago >= 0 && ago <= maxAgo;
                const isSel = viewYear === sel.y && m === sel.m;
                const isCur = viewYear === curY && m === curM;
                return (
                  <button
                    key={m}
                    disabled={!enabled}
                    onClick={() => { setMonthsAgo(ago); setOpen(false); }}
                    style={{
                      padding: '8px 0', borderRadius: '8px', fontSize: '12px',
                      fontWeight: isSel ? 800 : 600,
                      fontFamily: 'inherit',
                      border: isCur && !isSel ? '1px solid var(--primary)' : '1px solid transparent',
                      background: isSel ? 'var(--primary)' : enabled ? 'var(--gray-100)' : 'transparent',
                      color: isSel ? '#fff' : enabled ? 'var(--text-main)' : 'var(--text-faint)',
                      cursor: enabled ? 'pointer' : 'default',
                      transition: 'background 0.12s',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const navBtn = {
  background: 'var(--gray-100)', border: '1px solid var(--border-color)', borderRadius: '7px',
  width: '30px', height: '30px', display: 'flex', alignItems: 'center',
  justifyContent: 'center', color: 'var(--text-muted)',
};

export default function Budgets() {
  // Subscribe to the mask flag so toggling "hide amounts" re-renders this page.
  // Unlike Trends/Insights, this page reads no outlet context, so without this
  // subscription React Router's cached outlet element bails out of re-rendering
  // and the fmt.format() amounts stay stale until the next unrelated render.
  usePrivacy();
  const [month, setMonth] = useState('');
  const [monthsAgo, setMonthsAgo] = useState(0); // 0 = this month, 1 = last month, …
  const [monthOptions, setMonthOptions] = useState([{ monthsAgo: 0, label: 'This month' }]);
  const [budgets, setBudgets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null); // budget being edited
  const [form, setForm] = useState({ category: '', monthlyLimit: '', auto: false });
  const [saving, setSaving] = useState(false);
  // category → { suggested, avgMonthly, months } from real spending history
  const [suggestions, setSuggestions] = useState({});

  const load = useCallback(() => {
    return Promise.all([
      api.get(`/budgets?monthsAgo=${monthsAgo}`).then((r) => r.data),
      api.get('/categories').then((r) => r.data || []),
    ])
      .then(([b, cats]) => {
        setMonth(b?.month || '');
        setBudgets(b?.budgets || []);
        setCategories(cats.map((c) => c.name ?? c.Name).filter(Boolean));
      })
      .catch((err) => console.error('Failed to load budgets', err))
      .finally(() => setLoading(false));
  }, [monthsAgo]);

  useEffect(() => { load(); }, [load]);

  // Populate the month picker from the user's real transaction history (once).
  useEffect(() => {
    api.get('/budgets/months')
      .then((r) => { if (Array.isArray(r.data) && r.data.length) setMonthOptions(r.data); })
      .catch((err) => console.error('Failed to load months', err));
  }, []);

  // Per-category suggested limits, derived from average monthly spend (once).
  useEffect(() => {
    api.get('/budgets/suggestions')
      .then((r) => {
        const map = {};
        (r.data || []).forEach((sg) => { map[sg.category] = sg; });
        setSuggestions(map);
      })
      .catch((err) => console.error('Failed to load budget suggestions', err));
  }, []);

  const budgetedCats = new Set(budgets.map((b) => b.category));
  const availableCats = categories.filter((c) => !budgetedCats.has(c));

  const totalBudget = budgets.reduce((s2, b) => s2 + b.monthlyLimit, 0);
  const totalSpent  = budgets.reduce((s2, b) => s2 + b.spent, 0);
  const totalRemaining = totalBudget - totalSpent;

  const openAdd = () => {
    const category = availableCats[0] || '';
    const suggested = suggestions[category]?.suggested;
    setForm({ category, monthlyLimit: suggested ? String(suggested) : '', auto: !!suggested });
    setAdding(true);
  };

  // Switching category re-applies the suggestion unless the user typed their own amount.
  const changeCategory = (category) => {
    setForm((f) => {
      const keepTyped = !f.auto && f.monthlyLimit !== '';
      const suggested = suggestions[category]?.suggested;
      return keepTyped
        ? { ...f, category }
        : { category, monthlyLimit: suggested ? String(suggested) : '', auto: !!suggested };
    });
  };

  const saveNew = () => {
    const limit = Number(form.monthlyLimit);
    if (!form.category || !(limit > 0)) return;
    setSaving(true);
    api.post('/budgets', { category: form.category, monthlyLimit: limit })
      .then(() => { setAdding(false); return load(); })
      .catch((err) => {
        console.error(err);
        alert(err?.response?.data || 'Failed to add budget.');
      })
      .finally(() => setSaving(false));
  };

  const saveEdit = () => {
    const limit = Number(editing.monthlyLimit);
    if (!(limit > 0)) return;
    setSaving(true);
    api.put(`/budgets/${editing.id}`, { category: editing.category, monthlyLimit: limit })
      .then(() => { setEditing(null); return load(); })
      .catch((err) => { console.error(err); alert('Failed to update budget.'); })
      .finally(() => setSaving(false));
  };

  const remove = (b) => {
    if (!window.confirm(`Remove the budget for "${b.category}"?`)) return;
    api.delete(`/budgets/${b.id}`).then(load).catch((err) => console.error(err));
  };

  if (loading) {
    return (
      <div style={{ ...s.page, textAlign: 'center', paddingTop: '80px', color: 'var(--text-muted)' }}>
        Loading budgets…
      </div>
    );
  }

  return (
    <div style={s.page}>
      {/* ── Summary ── */}
      <div style={s.statsRow}>
        <StatCard label="Monthly budget" value={fmt.format(totalBudget)} sub="Repeats every month" />
        <StatCard label={monthsAgo === 0 ? `Spent so far · ${month}` : `Spent · ${month}`} value={fmt.format(totalSpent)} valueColor="#f87171" />
        <StatCard
          label={totalRemaining >= 0 ? 'Remaining' : 'Over budget'}
          value={fmt.format(Math.abs(totalRemaining))}
          valueColor={totalRemaining >= 0 ? '#34d399' : '#f87171'}
          accent={totalRemaining >= 0 ? '#34d399' : '#f87171'}
          sub={totalBudget > 0 ? `${Math.round((totalSpent / totalBudget) * 100)}% of budget used` : ''}
        />
      </div>

      <div style={s.headRow}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--text-main)' }}>
            Category budgets
          </h2>
          {/* The picker only changes which month's spend is shown — the limits themselves recur. */}
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>· spending in</span>
          {/* Calendar month picker — bounded to months with transaction history */}
          <MonthPicker
            monthsAgo={monthsAgo}
            setMonthsAgo={setMonthsAgo}
            maxAgo={monthOptions.reduce((m, o) => Math.max(m, o.monthsAgo), 0)}
          />
        </div>
        <button
          className="btn primary"
          onClick={openAdd}
          disabled={availableCats.length === 0}
          title={availableCats.length === 0 ? 'Every category already has a budget' : 'Add a budget'}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <FiPlus size={15} /> Add budget
        </button>
      </div>

      {/* Recurring-budget explainer — set once, applies to every month. */}
      <p style={{ margin: '-4px 0 16px', fontSize: '12.5px', color: 'var(--text-muted)', maxWidth: '660px' }}>
        Each budget is a recurring monthly limit — you set it once and it applies to every month
        automatically. Switch the month above to see how much you spent against it in that month.
      </p>

      {/* ── Budget cards ── */}
      {budgets.length === 0 ? (
        <div style={s.card}>
          <EmptyState
            icon="🎯"
            title="No budgets yet"
            subtitle="Set a monthly limit on a category once — it applies to every month automatically, so you never have to recreate it."
          />
        </div>
      ) : (
        <div style={s.grid}>
          {budgets.map((b) => {
            const pct = Math.min(b.percent, 100);
            const color = meterColor(b.percent, b.overBudget);
            return (
              <div key={b.id} style={s.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontWeight: 700, fontSize: '15px', color: 'var(--text-main)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {b.category}
                    </div>
                    <div className="tnum" style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {fmt.format(b.spent)} of {fmt.format(b.monthlyLimit)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    <button style={s.iconBtn} title="Edit limit" onClick={() => setEditing({ ...b })}>
                      <FiEdit2 size={14} />
                    </button>
                    <button style={{ ...s.iconBtn, color: 'var(--danger)' }} title="Remove" onClick={() => remove(b)}>
                      <FiTrash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Burn-down meter */}
                <div style={{ height: '10px', background: 'var(--gray-100)', borderRadius: '5px', overflow: 'hidden', margin: '14px 0 8px' }}>
                  <div style={{
                    width: `${Math.max(pct, 2)}%`, height: '100%',
                    background: color, borderRadius: '5px', transition: 'width 0.5s ease',
                  }} />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span style={{ fontWeight: 700, color }}>{b.percent}% used</span>
                  <span className="tnum" style={{ color: b.overBudget ? 'var(--danger)' : 'var(--text-muted)', fontWeight: 600 }}>
                    {b.overBudget
                      ? `${fmt.format(b.spent - b.monthlyLimit)} over`
                      : `${fmt.format(b.remaining)} left`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add / Edit modal ── */}
      <Modal
        open={adding || !!editing}
        onClose={() => { setAdding(false); setEditing(null); }}
        title={editing ? 'Edit budget' : 'Add budget'}
        width={360}
        footer={
          <>
            <button className="btn" onClick={() => { setAdding(false); setEditing(null); }}>Cancel</button>
            <button className="btn primary" onClick={editing ? saveEdit : saveNew} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <label style={s.label}>Category</label>
        {editing ? (
          <input className="field-input" style={{ width: '100%', marginBottom: '14px' }} value={editing.category} disabled />
        ) : (
          <select
            className="field-input"
            style={{ width: '100%', marginBottom: '14px' }}
            value={form.category}
            onChange={(e) => changeCategory(e.target.value)}
          >
            {availableCats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}

        <label style={s.label}>Monthly limit (₹)</label>
        <input
          className="field-input"
          type="number"
          min="1"
          style={{ width: '100%' }}
          value={editing ? editing.monthlyLimit : form.monthlyLimit}
          onChange={(e) => editing
            ? setEditing({ ...editing, monthlyLimit: e.target.value })
            : setForm({ ...form, monthlyLimit: e.target.value, auto: false })}
          autoFocus
        />
        {(() => {
          const sg = suggestions[editing ? editing.category : form.category];
          if (!sg) return null;
          const current = editing ? editing.monthlyLimit : form.monthlyLimit;
          const applied = String(current) === String(sg.suggested);
          return (
            <p style={{ margin: '8px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
              Suggested: <strong className="tnum" style={{ color: 'var(--text-main)' }}>{fmt.format(sg.suggested)}</strong>
              {' '}— you spend about {fmt.format(sg.avgMonthly)}/month here
              {' '}({sg.months === 1 ? 'this month so far' : `avg of last ${sg.months} months`}).
              {!applied && (
                <button
                  onClick={() => editing
                    ? setEditing({ ...editing, monthlyLimit: sg.suggested })
                    : setForm({ ...form, monthlyLimit: String(sg.suggested), auto: true })}
                  style={{
                    marginLeft: '6px', padding: 0, border: 'none', background: 'none',
                    color: 'var(--primary)', fontWeight: 700, fontSize: '12px',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  Use it
                </button>
              )}
            </p>
          );
        })()}
        <p style={{ margin: '8px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
          This limit repeats every month — set it once and it applies to all months.
        </p>
      </Modal>
    </div>
  );
}
