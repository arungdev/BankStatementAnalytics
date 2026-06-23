import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import DateRangePicker from '../components/Daterangepicker';

/* ─── Design tokens ─────────────────────────────────────────────────────── */
const T = {
  indigo:     '#4f46e5',
  indigoDark: '#4338ca',
  indigoDim:  '#eef2ff',
  indigoMid:  '#818cf8',
  indigoSoft: '#a5b4fc',
  surface:    '#ffffff',
  bg:         '#f8f9fb',
  cardDark:   '#1e1b4b',
  sidebarBg:  '#0f1117',
  border:     '#e5e7eb',
  borderSub:  '#f0f1f3',
  text:       '#111827',
  muted:      '#6b7280',
  faint:      '#9ca3af',
  white:      '#ffffff',
  red:        '#ef4444',
  green:      '#10b981',
  greenSoft:  '#6ee7b7',
};

const COLORS = [
  '#4f46e5','#7c3aed','#2563eb','#0891b2',
  '#059669','#d97706','#dc2626','#db2777',
  '#65a30d','#9333ea',
];

const GROUP_TABS = [
  { key: 'byCategory', label: 'Categories', singular: 'Category' },
  { key: 'byMerchant', label: 'Merchants',  singular: 'Merchant'  },
  { key: 'byTag',      label: 'Tags',       singular: 'Tag'       },
];

const fmt = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', minimumFractionDigits: 0,
});

const fmtFull = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', minimumFractionDigits: 2,
});

const fmtK = v => v >= 100000
  ? `₹${(v / 100000).toFixed(1)}L`
  : v >= 1000
  ? `₹${(v / 1000).toFixed(0)}k`
  : `₹${v}`;

const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const toISODate = (d) => d ? d.toISOString().split('T')[0] : null;

/* ─── Custom Tooltip ────────────────────────────────────────────────────── */
const ChartTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: T.cardDark, borderRadius: '10px',
      padding: '10px 14px', boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
    }}>
      <p style={{ margin: 0, fontWeight: 700, color: T.white, fontSize: '13px' }}>{d.name}</p>
      <p style={{ margin: '4px 0 0', color: T.indigoMid, fontWeight: 700, fontSize: '14px' }}>{fmt.format(d.total)}</p>
      {d.count != null && (
        <p style={{ margin: '2px 0 0', color: T.indigoSoft, fontSize: '11px' }}>{d.count} transactions</p>
      )}
      <p style={{ margin: '6px 0 0', color: T.indigoSoft, fontSize: '10px', opacity: 0.8 }}>Click to view transactions</p>
    </div>
  );
};

/* ─── Stat Card ─────────────────────────────────────────────────────────── */
const StatCard = ({ label, value, sub, accent }) => (
  <div style={{
    background: T.cardDark,
    borderRadius: '14px',
    padding: '20px 24px',
    flex: 1,
    minWidth: 0,
    boxShadow: '0 4px 20px rgba(79,70,229,0.15)',
  }}>
    <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: T.indigoSoft, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</p>
    <p style={{ margin: '8px 0 4px', fontSize: '22px', fontWeight: 800, color: T.white, letterSpacing: '-0.5px' }}>{value}</p>
    {sub && <p style={{ margin: 0, fontSize: '12px', color: accent || T.muted }}>{sub}</p>}
  </div>
);

/* ─── Transaction Tray ──────────────────────────────────────────────────── */
const TransactionTray = ({ open, onClose, groupSingular, item, transactions, loading, error, accounts }) => {
  const txArray = Array.isArray(transactions) ? transactions : [];
  const accountMap = (accounts || []).reduce((m, a) => { m[a.id] = a.bankName; return m; }, {});
  const total = item?.total ?? txArray.reduce((s, t) => s + t.amount, 0);

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      right: 0,
      bottom: 0,
      width: open ? '380px' : '0px',
      background: T.surface,
      borderLeft: open ? `1px solid ${T.border}` : 'none',
      boxShadow: open ? '-8px 0 40px rgba(0,0,0,0.08)' : 'none',
      transition: 'width 0.28s cubic-bezier(0.4,0,0.2,1)',
      overflow: 'hidden',
      zIndex: 500,
      display: 'flex',
      flexDirection: 'column',
    }}>
      {open && (
        <>
          {/* ── Header ── */}
          <div style={{ padding: '20px 20px 14px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '14px' }}>
              <div>
                <p style={{
                  margin: 0, fontSize: '11px', fontWeight: 700,
                  color: T.faint, textTransform: 'uppercase', letterSpacing: '0.08em',
                }}>
                  {groupSingular}
                </p>
                <h2 style={{ margin: '4px 0 0', fontSize: '18px', fontWeight: 800, color: T.text }}>
                  {item?.name}
                </h2>
              </div>
              <button
                onClick={onClose}
                style={{
                  border: 'none', background: T.bg, borderRadius: '8px',
                  width: '32px', height: '32px', cursor: 'pointer',
                  fontSize: '16px', color: T.muted, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >✕</button>
            </div>

            {/* Mini stat pills */}
            <div style={{ display: 'flex', gap: '8px' }}>
              {[
                { label: 'Total',        value: fmt.format(total) },
                { label: 'Transactions', value: (item?.count ?? txArray.length).toLocaleString('en-IN') },
              ].map(stat => (
                <div key={stat.label} style={{
                  flex: 1, background: T.bg, borderRadius: '8px',
                  padding: '10px 12px', border: `1px solid ${T.border}`,
                }}>
                  <p style={{ margin: 0, fontSize: '10px', fontWeight: 700, color: T.faint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {stat.label}
                  </p>
                  <p style={{ margin: '3px 0 0', fontSize: '15px', fontWeight: 800, color: T.text }}>
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* ── Transaction list ── */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: '48px 20px', textAlign: 'center' }}>
                <div style={{
                  width: '28px', height: '28px', borderRadius: '50%',
                  border: `3px solid ${T.indigoDim}`, borderTopColor: T.indigo,
                  animation: 'spin 0.7s linear infinite', margin: '0 auto 12px',
                }} />
                <p style={{ margin: 0, fontSize: '13px', color: T.muted }}>Loading transactions…</p>
              </div>
            ) : error ? (
              <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                <p style={{ margin: 0, fontSize: '13px', color: T.red }}>{error}</p>
              </div>
            ) : txArray.length === 0 ? (
              <div style={{ padding: '48px 20px', textAlign: 'center' }}>
                <div style={{
                  width: '44px', height: '44px', borderRadius: '50%',
                  background: T.bg, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', margin: '0 auto 12px', fontSize: '20px',
                }}>📭</div>
                <p style={{ margin: 0, fontWeight: 700, fontSize: '14px', color: T.text }}>No transactions</p>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: T.muted }}>Nothing found for this period.</p>
              </div>
            ) : (
              txArray.map((tx, i) => (
                <div
                  key={tx.id ?? i}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    padding: '13px 20px',
                    borderBottom: `1px solid ${T.borderSub}`,
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = T.bg}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  {/* Icon circle */}
                  <div style={{
                    width: '36px', height: '36px', borderRadius: '10px',
                    background: T.indigoDim, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', flexShrink: 0, fontSize: '16px',
                  }}>
                    💳
                  </div>

                  {/* Details */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      margin: 0, fontSize: '13px', fontWeight: 600, color: T.text,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {tx.description ?? '—'}
                    </p>
                    <p style={{ margin: '2px 0 0', fontSize: '11px', color: T.muted }}>
                      {fmtDate(tx.date)}
                      {accountMap[tx.accountId] ? ` · ${accountMap[tx.accountId]}` : ''}
                    </p>
                  </div>

                  {/* Amount */}
                  <p style={{
                    margin: 0, fontSize: '13px', fontWeight: 700,
                    color: T.red, flexShrink: 0,
                  }}>
                    −{fmtFull.format(tx.amount)}
                  </p>
                </div>
              ))
            )}
          </div>

          {/* ── Footer ── */}
          <div style={{
            padding: '12px 20px', borderTop: `1px solid ${T.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <p style={{ margin: 0, fontSize: '12px', color: T.faint }}>
              {txArray.length} transaction{txArray.length !== 1 ? 's' : ''}
            </p>
            <button
              onClick={onClose}
              style={{
                border: `1px solid ${T.border}`, background: T.bg,
                borderRadius: '7px', padding: '5px 12px',
                fontSize: '12px', fontWeight: 600, color: T.muted,
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
        </>
      )}
    </div>
  );
};

/* ─── Main Component ────────────────────────────────────────────────────── */
export default function Insights() {
  const [accounts, setAccounts]              = useState([]);
  const [selectedAccountIds, setSelectedIds] = useState([]);
  const [range, setRange]                    = useState({ start: null, end: null, preset: 'ALL', label: 'All Time' });
  const [groupBy, setGroupBy]                = useState('byCategory');
  const [insightsData, setInsightsData]      = useState(null);
  const [loading, setLoading]                = useState(false);

  const [trayOpen, setTrayOpen]         = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [txList, setTxList]             = useState([]);
  const [txLoading, setTxLoading]       = useState(false);
  const [txError, setTxError]           = useState(null);

  useEffect(() => {
    api.get('/statements/accounts')
      .then(res => {
        const list = res.data || [];
        setAccounts(list);
        if (list.length > 0) setSelectedIds(list.map(a => a.id));
      })
      .catch(err => console.error('Failed to load accounts', err));
  }, []);

  const fetchInsights = useCallback(() => {
    if (selectedAccountIds.length === 0) return;
    const p = new URLSearchParams();
    p.append('accountIds', selectedAccountIds.join(','));
    if (range.start) p.append('startDate', toISODate(range.start));
    if (range.end)   p.append('endDate',   toISODate(range.end));
    setLoading(true);
    api.get(`/dashboard/insights?${p.toString()}`)
      .then(res => setInsightsData(res.data))
      .catch(err => console.error('Failed to fetch insights', err))
      .finally(() => setLoading(false));
  }, [selectedAccountIds, range]);

  useEffect(() => { fetchInsights(); }, [fetchInsights]);

  const toggleAccount = (id) =>
    setSelectedIds(prev => prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]);

  const chartData     = insightsData?.[groupBy] || [];
  const grandTotal    = chartData.reduce((s, x) => s + x.total, 0);
  const topSpend      = chartData[0] || null;
  const avgSpend      = chartData.length ? grandTotal / chartData.length : 0;

  const activeTab     = GROUP_TABS.find(g => g.key === groupBy);
  const groupLabel    = activeTab?.label    ?? '';
  const groupSingular = activeTab?.singular ?? '';

  const handleSliceClick = useCallback((item) => {
    if (!item) return;
    setSelectedItem(item);
    setTrayOpen(true);
    setTxLoading(true);
    setTxError(null);
    setTxList([]);

    const p = new URLSearchParams();
    p.append('accountIds', selectedAccountIds.join(','));
    if (range.start) p.append('startDate', toISODate(range.start));
    if (range.end)   p.append('endDate',   toISODate(range.end));
    p.append('groupBy',    groupBy);
    p.append('groupValue', item.name);

    api.get(`/dashboard/insights/transactions?${p.toString()}`)
      .then(res => {
        const d = res.data;
        const list = Array.isArray(d)               ? d
          : Array.isArray(d?.transactions)           ? d.transactions
          : Array.isArray(d?.data)                   ? d.data
          : Array.isArray(d?.results)                ? d.results
          : Array.isArray(d?.items)                  ? d.items
          : [];
        setTxList(list);
      })
      .catch(err => {
        console.error('Failed to fetch transactions', err);
        setTxError('Could not load transactions. Please try again.');
      })
      .finally(() => setTxLoading(false));
  }, [selectedAccountIds, range, groupBy]);

  const closeTray = () => {
    setTrayOpen(false);
    setSelectedItem(null);
    setTxList([]);
    setTxError(null);
  };

  /* ── Styles ── */
  const s = {
    page: {
      padding: '28px 32px',
      background: T.bg,
      minHeight: '100vh',
      fontFamily: "'Inter', 'system-ui', sans-serif",
      transition: 'margin-right 0.28s cubic-bezier(0.4,0,0.2,1)',
    },
    pageHeader: {
      display: 'flex', justifyContent: 'space-between',
      alignItems: 'flex-start', marginBottom: '24px',
    },
    title:    { margin: 0, fontSize: '22px', fontWeight: 800, color: T.text, letterSpacing: '-0.4px' },
    subtitle: { margin: '4px 0 0', fontSize: '13px', color: T.muted },
    tabs: {
      display: 'flex', gap: '2px',
      background: T.indigoDim, padding: '4px', borderRadius: '10px',
    },
    tab: (active) => ({
      padding: '7px 18px', border: 'none', borderRadius: '8px',
      cursor: 'pointer', fontSize: '13px', fontWeight: 700,
      transition: 'all 0.18s ease',
      background: active ? T.indigo : 'transparent',
      color:      active ? T.white  : '#7c3aed',
      boxShadow:  active ? '0 2px 8px rgba(79,70,229,0.3)' : 'none',
    }),
    statsRow:  { display: 'flex', gap: '16px', marginBottom: '20px' },
    filterBar: {
      display: 'flex', gap: '10px', flexWrap: 'wrap',
      alignItems: 'center', marginBottom: '24px',
      padding: '14px 18px',
      background: T.surface,
      borderRadius: '12px',
      border: `1px solid ${T.border}`,
      boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
    },
    divider: { width: '1px', height: '24px', background: T.border, margin: '0 4px', flexShrink: 0 },
    accChip: (active) => ({
      display: 'flex', alignItems: 'center', gap: '5px',
      cursor: 'pointer', padding: '5px 11px', borderRadius: '7px',
      border: '1.5px solid',
      borderColor: active ? T.indigo : T.border,
      background:  active ? T.indigoDim : T.white,
      fontSize: '12px', fontWeight: 700,
      color: active ? T.indigo : T.muted,
      transition: 'all 0.15s',
      userSelect: 'none',
    }),
    dot: (color) => ({
      width: '8px', height: '8px', borderRadius: '50%',
      background: color, flexShrink: 0, boxShadow: `0 0 0 2px ${color}33`,
    }),
    chartsGrid: {
      display: 'grid', gridTemplateColumns: '3fr 2fr',
      gap: '20px', marginBottom: '20px',
    },
    card: {
      background: T.surface, borderRadius: '14px',
      padding: '22px 24px', border: `1px solid ${T.border}`,
      boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
    },
    cardTitle: { margin: '0 0 18px', fontSize: '13px', fontWeight: 700, color: T.text, letterSpacing: '-0.1px' },
    emptyState: {
      textAlign: 'center', padding: '64px 24px',
      background: T.surface, borderRadius: '14px',
      border: `1px solid ${T.border}`,
    },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
    th: (right) => ({
      padding: '10px 14px', textAlign: right ? 'right' : 'left',
      fontWeight: 700, color: T.muted, fontSize: '11px',
      textTransform: 'uppercase', letterSpacing: '0.06em',
      borderBottom: `2px solid ${T.border}`,
    }),
    td: (right) => ({
      padding: '11px 14px', textAlign: right ? 'right' : 'left',
      borderBottom: `1px solid ${T.borderSub}`, verticalAlign: 'middle',
    }),
  };

  const Skeleton = ({ w = '100%', h = 16, r = 6 }) => (
    <div style={{
      width: w, height: h, borderRadius: r,
      background: 'linear-gradient(90deg,#f0f1f3 25%,#e5e7eb 50%,#f0f1f3 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.4s infinite',
    }} />
  );

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <div style={{ ...s.page, flex: 1, marginRight: trayOpen ? '380px' : '0' }}>
        <style>{`
          @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
          @keyframes spin    { to { transform: rotate(360deg); } }
          .ins-row:hover { background: #fafbff !important; cursor: pointer; }
        `}</style>

        {/* ── Page header ── */}
        <div style={s.pageHeader}>
          <div>
            <h1 style={s.title}>Spending Insights</h1>
            <p style={s.subtitle}>Understand where your money goes</p>
          </div>
          <div style={s.tabs}>
            {GROUP_TABS.map(g => (
              <button key={g.key} onClick={() => setGroupBy(g.key)} style={s.tab(groupBy === g.key)}>
                {g.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Stat cards ── */}
        <div style={s.statsRow}>
          <StatCard
            label="Total Spent"
            value={loading ? '—' : fmt.format(grandTotal)}
            sub={loading ? '' : `Across ${chartData.length} ${groupLabel.toLowerCase()}`}
          />
          <StatCard
            label={`Top ${groupSingular}`}
            value={loading || !topSpend ? '—' : topSpend.name}
            sub={loading || !topSpend ? '' : fmt.format(topSpend.total)}
            accent={T.indigoSoft}
          />
          <StatCard
            label={`Avg per ${groupSingular}`}
            value={loading ? '—' : fmtK(Math.round(avgSpend))}
            sub={loading ? '' : `${chartData.length} ${groupLabel.toLowerCase()} tracked`}
          />
          <StatCard
            label="Highest Transaction Count"
            value={loading || !topSpend ? '—' : (topSpend.count ?? '—')}
            sub={loading || !topSpend ? '' : `in ${topSpend.name}`}
            accent={T.greenSoft}
          />
        </div>

        {/* ── Filter bar ── */}
        <div style={s.filterBar}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: T.faint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Period
            </span>
            <DateRangePicker
              value={range}
              onChange={setRange}
              showTime={false}
              align="left"
              placeholder="All Time"
            />
          </div>

          <div style={s.divider} />

          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: T.faint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Accounts
            </span>
            {accounts.map(acc => {
              const active = selectedAccountIds.includes(acc.id);
              const last4  = acc.accountNumber?.slice(-4)
                          ?? acc.maskedAccountNumber?.replace(/X/gi, '')?.slice(-4)
                          ?? '????';
              return (
                <label key={acc.id} style={s.accChip(active)}>
                  <input type="checkbox" checked={active} onChange={() => toggleAccount(acc.id)} style={{ display: 'none' }} />
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: active ? T.indigo : T.border, flexShrink: 0 }} />
                  {acc.bankName}
                  <span style={{ opacity: 0.6, fontWeight: 500 }}>···{last4}</span>
                </label>
              );
            })}
          </div>
        </div>

        {/* ── Content ── */}
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={s.chartsGrid}>
              <div style={s.card}><Skeleton h={320} r={10} /></div>
              <div style={s.card}><Skeleton h={320} r={10} /></div>
            </div>
            <div style={s.card}>
              {[...Array(5)].map((_, i) => (
                <div key={i} style={{ display: 'flex', gap: '16px', padding: '12px 0', borderBottom: `1px solid ${T.borderSub}` }}>
                  <Skeleton w={24} h={14} /><Skeleton w="30%" h={14} /><Skeleton w="10%" h={14} /><Skeleton w="15%" h={14} /><Skeleton w="20%" h={14} />
                </div>
              ))}
            </div>
          </div>
        ) : chartData.length === 0 ? (
          <div style={s.emptyState}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>📊</div>
            <p style={{ margin: 0, fontWeight: 700, color: T.text, fontSize: '15px' }}>No spending data</p>
            <p style={{ margin: '6px 0 0', color: T.muted, fontSize: '13px' }}>Try adjusting your date range or selecting more accounts.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* Charts row */}
            <div style={s.chartsGrid}>
              {/* Bar chart */}
              <div style={s.card}>
                <p style={s.cardTitle}>
                  Spend by {groupSingular}
                  <span style={{ fontWeight: 500, color: T.muted, marginLeft: '6px' }}>
                    ({chartData.length} {groupLabel.toLowerCase()})
                  </span>
                </p>
                <ResponsiveContainer width="100%" height={Math.max(260, chartData.length * 38)}>
                  <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 32, top: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={T.borderSub} />
                    <XAxis type="number" tickFormatter={fmtK} tick={{ fontSize: 11, fill: T.faint }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: T.muted }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: T.indigoDim }} />
                    <Bar
                      dataKey="total" radius={[0, 6, 6, 0]} maxBarSize={28}
                      onClick={(data) => handleSliceClick(data)}
                      style={{ cursor: 'pointer' }}
                    >
                      {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Donut chart */}
              <div style={s.card}>
                <p style={s.cardTitle}>Distribution</p>
                <div style={{ position: 'relative' }}>
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={chartData} cx="50%" cy="45%"
                        innerRadius={72} outerRadius={108}
                        dataKey="total" nameKey="name" paddingAngle={2}
                        onClick={(data) => handleSliceClick(data)}
                        style={{ cursor: 'pointer' }}
                      >
                        {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="none" />)}
                      </Pie>
                      <Tooltip
                        formatter={v => fmt.format(v)}
                        contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{
                    position: 'absolute', top: '45%', left: '50%',
                    transform: 'translate(-50%, -50%)',
                    textAlign: 'center', pointerEvents: 'none',
                  }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: T.faint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total</div>
                    <div style={{ fontSize: '17px', fontWeight: 800, color: T.text, letterSpacing: '-0.5px' }}>{fmtK(grandTotal)}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
                  {chartData.slice(0, 8).map((item, i) => (
                    <div
                      key={i} onClick={() => handleSliceClick(item)}
                      style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: T.muted, cursor: 'pointer' }}
                    >
                      <span style={s.dot(COLORS[i % COLORS.length])} />
                      {item.name}
                    </div>
                  ))}
                  {chartData.length > 8 && (
                    <div style={{ fontSize: '11px', color: T.faint }}>+{chartData.length - 8} more</div>
                  )}
                </div>
              </div>
            </div>

            {/* Breakdown table */}
            <div style={s.card}>
              <p style={s.cardTitle}>Full Breakdown</p>
              <table style={s.table}>
                <thead>
                  <tr style={{ background: T.bg }}>
                    <th style={s.th(false)}>#</th>
                    <th style={s.th(false)}>Name</th>
                    <th style={s.th(true)}>Transactions</th>
                    <th style={s.th(true)}>Total Spend</th>
                    <th style={s.th(true)} />
                    <th style={s.th(true)}>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((item, i) => {
                    const share = grandTotal > 0 ? (item.total / grandTotal) * 100 : 0;
                    const barW  = `${Math.max(share, 2).toFixed(1)}%`;
                    return (
                      <tr
                        key={i}
                        className="ins-row"
                        onClick={() => handleSliceClick(item)}
                        style={{ background: trayOpen && selectedItem?.name === item.name ? T.indigoDim : '' }}
                      >
                        <td style={s.td(false)}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={s.dot(COLORS[i % COLORS.length])} />
                            <span style={{ color: T.faint, fontWeight: 600, fontSize: '12px' }}>{i + 1}</span>
                          </span>
                        </td>
                        <td style={s.td(false)}>
                          <span style={{ fontWeight: 700, color: T.text }}>{item.name}</span>
                        </td>
                        <td style={{ ...s.td(true), color: T.muted }}>
                          {item.count != null ? item.count.toLocaleString('en-IN') : '—'}
                        </td>
                        <td style={{ ...s.td(true), fontWeight: 700, color: T.red }}>
                          {fmt.format(item.total)}
                        </td>
                        <td style={{ ...s.td(false), width: '120px' }}>
                          <div style={{ height: '6px', background: T.borderSub, borderRadius: '4px', overflow: 'hidden', minWidth: '80px' }}>
                            <div style={{
                              width: barW, height: '100%',
                              background: COLORS[i % COLORS.length],
                              borderRadius: '4px', transition: 'width 0.5s ease',
                            }} />
                          </div>
                        </td>
                        <td style={{ ...s.td(true), fontWeight: 700, color: T.text, fontSize: '12px', minWidth: '44px' }}>
                          {share.toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: T.bg }}>
                    <td colSpan={3} style={{ padding: '12px 14px', fontWeight: 700, color: T.muted, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Total — {chartData.length} {groupLabel.toLowerCase()}
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 800, color: T.text, fontSize: '14px' }}>
                      {fmt.format(grandTotal)}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── RHS Tray ── */}
      <TransactionTray
        open={trayOpen}
        onClose={closeTray}
        groupSingular={groupSingular}
        item={selectedItem}
        transactions={txList}
        loading={txLoading}
        error={txError}
        accounts={accounts}
      />
    </div>
  );
}