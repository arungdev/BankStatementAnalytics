import { useState, useEffect, useCallback } from 'react';
import { FiPlus, FiEdit2, FiTrash2, FiX, FiCalendar, FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import api from '../api/client';
import StatCard from '../components/StatCard';
import EmptyState from '../components/EmptyState';
import { currencyFormatter as fmt } from '../utils/format';

/* ─── Design tokens — aligned with Insights/Trends/Overview ─────────────── */
const T = {
  indigo:     '#4f46e5',
  surface:    '#ffffff',
  bg:         '#f3f4f6',
  border:     '#e5e7eb',
  borderSub:  '#f0f1f3',
  text:       '#111827',
  muted:      '#6b7280',
  faint:      '#9ca3af',
  red:        '#ef4444',
  amber:      '#f59e0b',
  green:      '#10b981',
};

// Meter colour by burn-down: comfortable → warning → over.
const meterColor = (percent, over) =>
  over || percent >= 100 ? T.red : percent >= 80 ? T.amber : T.green;

const s = {
  page: {
    padding: '28px 32px',
    background: T.bg,
    minHeight: '100vh',
    fontFamily: "'Inter', 'system-ui', sans-serif",
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
    background: T.surface, borderRadius: '14px',
    padding: '20px 22px', border: `1px solid ${T.border}`,
    boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
  },
  iconBtn: {
    background: T.bg, border: `1px solid ${T.border}`, borderRadius: '6px',
    width: '30px', height: '30px', display: 'flex', alignItems: 'center',
    justifyContent: 'center', cursor: 'pointer', color: T.muted,
  },
  label: { display: 'block', fontSize: '12px', fontWeight: 600, color: T.muted, marginBottom: '4px' },
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
          background: T.surface, border: `1px solid ${T.border}`, borderRadius: '8px',
          padding: '7px 12px', fontSize: '13px', fontWeight: 700, color: T.text,
          cursor: 'pointer', minWidth: '150px', justifyContent: 'space-between',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <FiCalendar size={14} style={{ color: T.muted }} /> {selLabel}
        </span>
        <FiChevronRight size={14} style={{ color: T.faint, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 400 }} />
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 401,
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: '12px',
            boxShadow: '0 12px 32px rgba(0,0,0,0.12)', padding: '14px', width: '260px',
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
              <span style={{ fontSize: '14px', fontWeight: 800, color: T.text }}>{viewYear}</span>
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
                      border: isCur && !isSel ? `1px solid ${T.indigo}` : '1px solid transparent',
                      background: isSel ? T.indigo : enabled ? T.bg : 'transparent',
                      color: isSel ? '#fff' : enabled ? T.text : T.faint,
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
  background: T.bg, border: `1px solid ${T.border}`, borderRadius: '7px',
  width: '30px', height: '30px', display: 'flex', alignItems: 'center',
  justifyContent: 'center', color: T.muted,
};

export default function Budgets() {
  const [month, setMonth] = useState('');
  const [monthsAgo, setMonthsAgo] = useState(0); // 0 = this month, 1 = last month, …
  const [monthOptions, setMonthOptions] = useState([{ monthsAgo: 0, label: 'This month' }]);
  const [budgets, setBudgets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null); // budget being edited
  const [form, setForm] = useState({ category: '', monthlyLimit: '' });
  const [saving, setSaving] = useState(false);

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

  const budgetedCats = new Set(budgets.map((b) => b.category));
  const availableCats = categories.filter((c) => !budgetedCats.has(c));

  const totalBudget = budgets.reduce((s2, b) => s2 + b.monthlyLimit, 0);
  const totalSpent  = budgets.reduce((s2, b) => s2 + b.spent, 0);
  const totalRemaining = totalBudget - totalSpent;

  const openAdd = () => {
    setForm({ category: availableCats[0] || '', monthlyLimit: '' });
    setAdding(true);
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
      <div style={{ ...s.page, textAlign: 'center', paddingTop: '80px', color: T.muted }}>
        Loading budgets…
      </div>
    );
  }

  return (
    <div style={s.page}>
      {/* ── Summary ── */}
      <div style={s.statsRow}>
        <StatCard label={`Budgeted · ${month}`} value={fmt.format(totalBudget)} />
        <StatCard label={monthsAgo === 0 ? 'Spent so far' : 'Spent'} value={fmt.format(totalSpent)} valueColor="#f87171" />
        <StatCard
          label={totalRemaining >= 0 ? 'Remaining' : 'Over budget'}
          value={fmt.format(Math.abs(totalRemaining))}
          valueColor={totalRemaining >= 0 ? '#34d399' : '#f87171'}
          accent={totalRemaining >= 0 ? '#34d399' : '#f87171'}
          sub={totalBudget > 0 ? `${Math.round((totalSpent / totalBudget) * 100)}% of budget used` : ''}
        />
      </div>

      <div style={s.headRow}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: T.text }}>
            Category budgets
          </h2>
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

      {/* ── Budget cards ── */}
      {budgets.length === 0 ? (
        <div style={s.card}>
          <EmptyState
            icon="🎯"
            title="No budgets yet"
            subtitle="Set a monthly limit on a spending category to track how much you have left this month."
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
                      fontWeight: 700, fontSize: '15px', color: T.text,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {b.category}
                    </div>
                    <div style={{ fontSize: '12px', color: T.muted, marginTop: '2px' }}>
                      {fmt.format(b.spent)} of {fmt.format(b.monthlyLimit)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    <button style={s.iconBtn} title="Edit limit" onClick={() => setEditing({ ...b })}>
                      <FiEdit2 size={14} />
                    </button>
                    <button style={{ ...s.iconBtn, color: T.red }} title="Remove" onClick={() => remove(b)}>
                      <FiTrash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Burn-down meter */}
                <div style={{ height: '10px', background: T.borderSub, borderRadius: '5px', overflow: 'hidden', margin: '14px 0 8px' }}>
                  <div style={{
                    width: `${Math.max(pct, 2)}%`, height: '100%',
                    background: color, borderRadius: '5px', transition: 'width 0.5s ease',
                  }} />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span style={{ fontWeight: 700, color }}>{b.percent}% used</span>
                  <span style={{ color: b.overBudget ? T.red : T.muted, fontWeight: 600 }}>
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
      {(adding || editing) && (
        <>
          <div
            onClick={() => { setAdding(false); setEditing(null); }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000 }}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            width: '360px', background: '#fff', padding: '24px', borderRadius: '10px',
            zIndex: 10001, boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0 }}>{editing ? 'Edit budget' : 'Add budget'}</h3>
              <button style={s.iconBtn} onClick={() => { setAdding(false); setEditing(null); }}>
                <FiX size={16} />
              </button>
            </div>

            <label style={s.label}>Category</label>
            {editing ? (
              <input className="field-input" style={{ width: '100%', marginBottom: '14px' }} value={editing.category} disabled />
            ) : (
              <select
                className="field-input"
                style={{ width: '100%', marginBottom: '14px' }}
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                {availableCats.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}

            <label style={s.label}>Monthly limit (₹)</label>
            <input
              className="field-input"
              type="number"
              min="1"
              style={{ width: '100%', marginBottom: '20px' }}
              value={editing ? editing.monthlyLimit : form.monthlyLimit}
              onChange={(e) => editing
                ? setEditing({ ...editing, monthlyLimit: e.target.value })
                : setForm({ ...form, monthlyLimit: e.target.value })}
              autoFocus
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button className="btn" onClick={() => { setAdding(false); setEditing(null); }}>Cancel</button>
              <button className="btn primary" onClick={editing ? saveEdit : saveNew} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
