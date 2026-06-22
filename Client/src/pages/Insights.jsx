import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import DateRangePicker from '../components/Daterangepicker'; // adjust path to wherever DateRangePicker.jsx lives

/* ─── Design tokens ─────────────────────────────────────────────────────── */
const T = {
  indigo:   '#4f46e5',
  indigoDim:'#eef2ff',
  indigoMid:'#818cf8',
  surface:  '#ffffff',
  bg:       '#f8f9fb',
  border:   '#e5e7eb',
  borderSub:'#f0f1f3',
  text:     '#111827',
  muted:    '#6b7280',
  faint:    '#9ca3af',
  red:      '#ef4444',
  green:    '#10b981',
};

const COLORS = [
  '#4f46e5','#7c3aed','#2563eb','#0891b2',
  '#059669','#d97706','#dc2626','#db2777',
  '#65a30d','#9333ea',
];

const GROUP_TABS = [
  { key: 'byCategory', label: 'Categories' },
  { key: 'byMerchant', label: 'Merchants'  },
  { key: 'byTag',      label: 'Tags'       },
];

const fmt = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', minimumFractionDigits: 0,
});

const fmtK = v => v >= 100000
  ? `₹${(v / 100000).toFixed(1)}L`
  : v >= 1000
  ? `₹${(v / 1000).toFixed(0)}k`
  : `₹${v}`;

const toISODate = (d) => d ? d.toISOString().split('T')[0] : null;

/* ─── Custom Tooltip ────────────────────────────────────────────────────── */
const ChartTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: '#1e1b4b', borderRadius: '10px',
      padding: '10px 14px', boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
    }}>
      <p style={{ margin: 0, fontWeight: 700, color: '#fff', fontSize: '13px' }}>{d.name}</p>
      <p style={{ margin: '4px 0 0', color: T.indigoMid, fontWeight: 700, fontSize: '14px' }}>{fmt.format(d.total)}</p>
      {d.count != null && (
        <p style={{ margin: '2px 0 0', color: '#a5b4fc', fontSize: '11px' }}>{d.count} transactions</p>
      )}
    </div>
  );
};

/* ─── Stat Card ─────────────────────────────────────────────────────────── */
const StatCard = ({ label, value, sub, accent }) => (
  <div style={{
    background: '#1e1b4b', borderRadius: '14px',
    padding: '20px 24px', flex: 1, minWidth: 0,
    boxShadow: '0 4px 20px rgba(79,70,229,0.15)',
  }}>
    <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: '#a5b4fc', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</p>
    <p style={{ margin: '8px 0 4px', fontSize: '22px', fontWeight: 800, color: '#fff', letterSpacing: '-0.5px' }}>{value}</p>
    {sub && <p style={{ margin: 0, fontSize: '12px', color: accent || '#6b7280' }}>{sub}</p>}
  </div>
);

/* ─── Main Component ────────────────────────────────────────────────────── */
export default function Insights() {
  const [accounts, setAccounts]               = useState([]);
  const [selectedAccountIds, setSelectedIds]  = useState([]);

  // Date range now owned by DateRangePicker: { start: Date|null, end: Date|null, preset, label }
  const [range, setRange] = useState({ start: null, end: null, preset: 'ALL', label: 'All Time' });

  const [groupBy, setGroupBy]                 = useState('byCategory');
  const [insightsData, setInsightsData]       = useState(null);
  const [loading, setLoading]                 = useState(false);

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

  const chartData  = insightsData?.[groupBy] || [];
  const grandTotal = chartData.reduce((s, x) => s + x.total, 0);
  const topSpend   = chartData[0] || null;
  const avgSpend   = chartData.length ? grandTotal / chartData.length : 0;
  const groupLabel = GROUP_TABS.find(g => g.key === groupBy)?.label ?? '';

  /* ── Inline styles (component-scoped) ─────────────────────────────────── */
  const s = {
    page: {
      padding: '28px 32px',
      background: T.bg,
      minHeight: '100vh',
      fontFamily: "'Inter', 'system-ui', sans-serif",
    },
    pageHeader: {
      display: 'flex', justifyContent: 'space-between',
      alignItems: 'flex-start', marginBottom: '24px',
    },
    title: {
      margin: 0, fontSize: '22px', fontWeight: 800,
      color: T.text, letterSpacing: '-0.4px',
    },
    subtitle: {
      margin: '4px 0 0', fontSize: '13px', color: T.muted,
    },
    tabs: {
      display: 'flex', gap: '2px',
      background: '#ede9fe', padding: '4px', borderRadius: '10px',
    },
    tab: (active) => ({
      padding: '7px 18px', border: 'none', borderRadius: '8px',
      cursor: 'pointer', fontSize: '13px', fontWeight: 700,
      transition: 'all 0.18s ease',
      background: active ? T.indigo : 'transparent',
      color:      active ? '#fff' : '#7c3aed',
      boxShadow:  active ? '0 2px 8px rgba(79,70,229,0.3)' : 'none',
    }),
    statsRow: {
      display: 'flex', gap: '16px', marginBottom: '20px',
    },
    filterBar: {
      display: 'flex', gap: '10px', flexWrap: 'wrap',
      alignItems: 'center', marginBottom: '24px',
      padding: '14px 18px',
      background: T.surface,
      borderRadius: '12px',
      border: `1px solid ${T.border}`,
      boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
    },
    divider: {
      width: '1px', height: '24px',
      background: T.border, margin: '0 4px', flexShrink: 0,
    },
    accChip: (active) => ({
      display: 'flex', alignItems: 'center', gap: '5px',
      cursor: 'pointer', padding: '5px 11px', borderRadius: '7px',
      border: '1.5px solid',
      borderColor: active ? T.indigo : T.border,
      background:  active ? T.indigoDim : '#fff',
      fontSize: '12px', fontWeight: 700,
      color: active ? T.indigo : T.muted,
      transition: 'all 0.15s',
      userSelect: 'none',
    }),
    dot: (color) => ({
      width: '8px', height: '8px', borderRadius: '50%',
      background: color, flexShrink: 0,
      boxShadow: `0 0 0 2px ${color}33`,
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
    cardTitle: {
      margin: '0 0 18px', fontSize: '13px',
      fontWeight: 700, color: T.text, letterSpacing: '-0.1px',
    },
    emptyState: {
      textAlign: 'center', padding: '64px 24px',
      background: T.surface, borderRadius: '14px',
      border: `1px solid ${T.border}`,
    },
    table: {
      width: '100%', borderCollapse: 'collapse', fontSize: '13px',
    },
    th: (right) => ({
      padding: '10px 14px',
      textAlign: right ? 'right' : 'left',
      fontWeight: 700, color: T.muted,
      fontSize: '11px', textTransform: 'uppercase',
      letterSpacing: '0.06em',
      borderBottom: `2px solid ${T.border}`,
    }),
    td: (right) => ({
      padding: '11px 14px',
      textAlign: right ? 'right' : 'left',
      borderBottom: `1px solid ${T.borderSub}`,
      verticalAlign: 'middle',
    }),
  };

  /* ── Skeleton loader ──────────────────────────────────────────────────── */
  const Skeleton = ({ w = '100%', h = 16, r = 6 }) => (
    <div style={{
      width: w, height: h, borderRadius: r,
      background: 'linear-gradient(90deg,#f0f1f3 25%,#e5e7eb 50%,#f0f1f3 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.4s infinite',
    }} />
  );

  return (
    <div style={s.page}>
      <style>{`
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        .ins-row:hover { background: #fafbff !important; }
      `}</style>

      {/* ── Page header ─────────────────────────────────────────────────── */}
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

      {/* ── Stat cards ──────────────────────────────────────────────────── */}
      <div style={s.statsRow}>
        <StatCard
          label="Total Spent"
          value={loading ? '—' : fmt.format(grandTotal)}
          sub={loading ? '' : `Across ${chartData.length} ${groupLabel.toLowerCase()}`}
        />
        <StatCard
          label={`Top ${groupLabel.slice(0,-1)}`}
          value={loading || !topSpend ? '—' : topSpend.name}
          sub={loading || !topSpend ? '' : fmt.format(topSpend.total)}
          accent="#a5b4fc"
        />
        <StatCard
          label={`Avg per ${groupLabel.slice(0,-1)}`}
          value={loading ? '—' : fmtK(Math.round(avgSpend))}
          sub={loading ? '' : `${chartData.length} ${groupLabel.toLowerCase()} tracked`}
        />
        <StatCard
          label="Highest Transaction Count"
          value={loading || !topSpend ? '—' : (topSpend.count ?? '—')}
          sub={loading || !topSpend ? '' : `in ${topSpend.name}`}
          accent="#6ee7b7"
        />
      </div>

      {/* ── Filter bar ──────────────────────────────────────────────────── */}
      <div style={s.filterBar}>
        {/* Date range */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: T.faint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Period</span>
          <DateRangePicker
            value={range}
            onChange={setRange}
            showTime={false}
            align="left"
            placeholder="All Time"
          />
        </div>

        <div style={s.divider} />

        {/* Account chips */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: T.faint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Accounts</span>
          {accounts.map(acc => {
            const active = selectedAccountIds.includes(acc.id);
            return (
              <label key={acc.id} style={s.accChip(active)}>
                <input type="checkbox" checked={active} onChange={() => toggleAccount(acc.id)} style={{ display: 'none' }} />
                <span style={{
                  width: '7px', height: '7px', borderRadius: '50%',
                  background: active ? T.indigo : T.border, flexShrink: 0,
                }} />
                {acc.bankName}
                <span style={{ opacity: 0.6, fontWeight: 500 }}>···{acc.maskedAccountNumber?.slice(-4) ?? acc.accountNumber?.slice(-4)}</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={s.chartsGrid}>
            <div style={s.card}><Skeleton h={320} r={10} /></div>
            <div style={s.card}><Skeleton h={320} r={10} /></div>
          </div>
          <div style={s.card}>
            {[...Array(5)].map((_,i) => (
              <div key={i} style={{ display:'flex', gap:'16px', padding:'12px 0', borderBottom:`1px solid ${T.borderSub}` }}>
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

          {/* Charts */}
          <div style={s.chartsGrid}>

            {/* Bar chart */}
            <div style={s.card}>
              <p style={s.cardTitle}>
                Spend by {groupLabel.slice(0,-1)}
                <span style={{ fontWeight: 500, color: T.muted, marginLeft: '6px' }}>({chartData.length} {groupLabel.toLowerCase()})</span>
              </p>
              <ResponsiveContainer width="100%" height={Math.max(260, chartData.length * 38)}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 32, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={T.borderSub} />
                  <XAxis type="number" tickFormatter={fmtK} tick={{ fontSize: 11, fill: T.faint }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: T.muted }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f5f3ff' }} />
                  <Bar dataKey="total" radius={[0, 6, 6, 0]} maxBarSize={28}>
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
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
                    >
                      {chartData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="none" />
                      ))}
                    </Pie>
                    <Tooltip formatter={v => fmt.format(v)} contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }} />
                  </PieChart>
                </ResponsiveContainer>
                {/* Center label */}
                <div style={{
                  position: 'absolute', top: '45%', left: '50%',
                  transform: 'translate(-50%, -50%)',
                  textAlign: 'center', pointerEvents: 'none',
                }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: T.faint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total</div>
                  <div style={{ fontSize: '17px', fontWeight: 800, color: T.text, letterSpacing: '-0.5px' }}>{fmtK(grandTotal)}</div>
                </div>
              </div>
              {/* Mini legend */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
                {chartData.slice(0, 8).map((item, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: T.muted }}>
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
                    <tr key={i} className="ins-row" style={{ background: '' }}>
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
                      {/* Progress bar */}
                      <td style={{ ...s.td(false), width: '120px' }}>
                        <div style={{ height: '6px', background: T.borderSub, borderRadius: '4px', overflow: 'hidden', minWidth: '80px' }}>
                          <div style={{
                            width: barW, height: '100%',
                            background: COLORS[i % COLORS.length],
                            borderRadius: '4px',
                            transition: 'width 0.5s ease',
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
  );
}