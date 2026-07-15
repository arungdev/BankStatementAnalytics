import { useState, useEffect, useCallback, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useAccount } from '../context/useAccount';
import { ALL_ACCOUNTS } from '../components/AccountFilter';
import api from '../api/client';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import DateRangePicker from '../components/Daterangepicker';
import { FilterGroup, FilterPill } from '../components/PageHeader';
import StatCard from '../components/StatCard';
import EmptyState from '../components/ui/EmptyState';
import Avatar from '../components/ui/Avatar';
import Drawer from '../components/ui/Drawer';
import useTheme from '../context/useTheme';
import { getToken } from '../theme/chartTheme';
import { currencyFormatter as fmt, currencyFormatterFull as fmtFull, isAmountMasked, MASKED_AMOUNT } from '../utils/format';

/* ─── Design tokens — mapped to the global CSS variable system. DOM inline
 * styles consume var() directly; recharts SVG colors can't, so they're
 * resolved via getToken() into `chartC`/`palette` inside the component. */
const T = {
  indigo:     'var(--primary)',
  indigoDim:  'var(--primary-light)',
  indigoSoft: 'var(--stat-tile-label)',
  surface:    'var(--surface)',
  surface2:   'var(--surface-2)',
  bg:         'var(--bg)',
  border:     'var(--border-color)',
  borderSub:  'var(--border-subtle)',
  text:       'var(--text-main)',
  muted:      'var(--text-muted)',
  faint:      'var(--text-faint)',
  red:        'var(--danger)',
  greenSoft:  '#6ee7b7',
};

const GROUP_TABS = [
  { key: 'byCategory', label: 'Categories', singular: 'Category' },
  { key: 'byMerchant', label: 'Merchants',  singular: 'Merchant'  },
  { key: 'byTag',      label: 'Tags',       singular: 'Tag'       },
];

const fmtK = v => isAmountMasked()
  ? MASKED_AMOUNT
  : v >= 100000
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

/* ─── Custom bar-chart tooltip — deliberately a dark tile in both themes ─── */
const ChartTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: '#1e1b4b', borderRadius: '10px',
      padding: '10px 14px', boxShadow: 'var(--shadow-lg)',
    }}>
      <p style={{ margin: 0, fontWeight: 700, color: '#fff', fontSize: '13px' }}>{d.name}</p>
      <p style={{ margin: '4px 0 0', color: '#818cf8', fontWeight: 700, fontSize: '14px' }}>{fmt.format(d.total)}</p>
      {d.count != null && (
        <p style={{ margin: '2px 0 0', color: '#a5b4fc', fontSize: '11px' }}>{d.count} transactions</p>
      )}
      <p style={{ margin: '6px 0 0', color: '#a5b4fc', fontSize: '10px', opacity: 0.8 }}>Click to view transactions</p>
    </div>
  );
};

/* ─── InsightsFilters — rendered in PageHeader's filter row ────────────── */
export function InsightsFilters({
  range, setRange,
  groupBy, setGroupBy,
}) {
  return (
    <>
      {/* Period */}
      <FilterGroup style={{ position: 'relative', zIndex: 'var(--z-dropdown)' }}>
        <DateRangePicker
          value={range}
          onChange={setRange}
          showTime={false}
          align="left"
          placeholder="All Time"
        />
      </FilterGroup>

      {/* Group by */}
      <FilterGroup label="Group by">
        {GROUP_TABS.map(g => (
          <FilterPill key={g.key} active={groupBy === g.key} onClick={() => setGroupBy(g.key)}>
            {g.label}
          </FilterPill>
        ))}
      </FilterGroup>
    </>
  );
}

/* ─── Main Component ────────────────────────────────────────────────────── */
export default function Insights() {
  const {
    accounts:     accounts = [],
    insightRange: range     = { start: null, end: null },
    insightGroupBy: groupBy = 'byCategory',
  } = useOutletContext() ?? {};
  const { selectedAccountId } = useAccount();
  const { theme } = useTheme();
  const [insightsData, setInsightsData]      = useState(null);
  const [loading, setLoading]                = useState(false);

  const [trayOpen, setTrayOpen]         = useState(false);
  const [drawerWidth, setDrawerWidth]   = useState(400);
  const [selectedItem, setSelectedItem] = useState(null);
  const [txList, setTxList]             = useState([]);
  const [txLoading, setTxLoading]       = useState(false);
  const [txError, setTxError]           = useState(null);

  // Resolved chart colors (recharts SVG can't read CSS var()). Recomputed on
  // theme flip; `palette` is the categorical series color set.
  const palette = useMemo(
    () => [1, 2, 3, 4, 5, 6, 7, 8].map((i) => getToken(`chart-${i}`)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme]
  );
  const chartC = useMemo(() => ({
    grid: getToken('chart-grid'),
    tick: getToken('chart-tick'),
    muted: getToken('text-muted'),
    cursor: getToken('primary-light'),
    tooltipBg: getToken('surface'),
    tooltipText: getToken('text-main'),
    tooltipBorder: getToken('border-color'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [theme]);

  // "All accounts" → every owned account id; otherwise the single selected id.
  const accountIdsParam = useMemo(() => {
    if (selectedAccountId === ALL_ACCOUNTS) return accounts.map(a => a.id).join(',');
    return selectedAccountId ? String(selectedAccountId) : '';
  }, [selectedAccountId, accounts]);

  const fetchInsights = useCallback(() => {
    if (!accountIdsParam) return;
    const p = new URLSearchParams();
    p.append('accountIds', accountIdsParam);
    if (range.start) p.append('startDate', toISODate(range.start));
    if (range.end)   p.append('endDate',   toISODate(range.end));
    setLoading(true);
    api.get(`/dashboard/insights?${p.toString()}`)
      .then(res => setInsightsData(res.data))
      .catch(err => console.error('Failed to fetch insights', err))
      .finally(() => setLoading(false));
  }, [accountIdsParam, range]);

  useEffect(() => { fetchInsights(); }, [fetchInsights]);

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
    p.append('accountIds', accountIdsParam);
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
  }, [accountIdsParam, range, groupBy]);

  const closeTray = () => {
    setTrayOpen(false);
    setSelectedItem(null);
    setTxList([]);
    setTxError(null);
  };

  const accountMap = (accounts || []).reduce((m, a) => { m[a.id] = a.bankName; return m; }, {});
  const trayTotal = selectedItem?.total ?? txList.reduce((sum, t) => sum + t.amount, 0);

  const s = {
    page: {
      padding: '28px 32px',
      background: T.bg,
      minHeight: '100vh',
      transition: 'margin-right 0.28s cubic-bezier(0.4,0,0.2,1)',
      overflow: 'visible',
    },
    statsRow: { display: 'flex', gap: '16px', marginBottom: '20px' },
    chartsGrid: {
      display: 'grid', gridTemplateColumns: '3fr 2fr',
      gap: '20px', marginBottom: '20px', alignItems: 'stretch',
    },
    card: {
      background: T.surface, borderRadius: '14px',
      padding: '22px 24px', border: `1px solid ${T.border}`,
      boxShadow: 'var(--shadow-sm)',
    },
    cardTitle: { margin: '0 0 18px', fontSize: '13px', fontWeight: 700, color: T.text, letterSpacing: '-0.1px' },
    emptyState: {
      background: T.surface, borderRadius: '14px',
      border: `1px solid ${T.border}`,
    },
    tableScroll: { maxHeight: '440px', overflowY: 'auto', margin: '0 -4px' },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
    th: (right) => ({
      padding: '10px 14px', textAlign: right ? 'right' : 'left',
      fontWeight: 700, color: T.muted, fontSize: '11px',
      textTransform: 'uppercase', letterSpacing: '0.06em',
      background: T.surface2, boxShadow: `inset 0 -2px 0 ${T.border}`,
      position: 'sticky', top: 0, zIndex: 2,
    }),
    td: (right) => ({
      padding: '11px 14px', textAlign: right ? 'right' : 'left',
      borderBottom: `1px solid ${T.borderSub}`, verticalAlign: 'middle',
    }),
    dot: (color) => ({
      width: '8px', height: '8px', borderRadius: '50%',
      background: color, flexShrink: 0, boxShadow: `0 0 0 2px ${color}33`,
    }),
  };

  const Skeleton = ({ w = '100%', h = 16, r = 6 }) => (
    <div style={{
      width: w, height: h, borderRadius: r,
      background: 'linear-gradient(90deg, var(--gray-100) 25%, var(--gray-200) 50%, var(--gray-100) 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.4s infinite',
    }} />
  );

  return (
    <div style={{ display: 'flex', minHeight: '100vh', overflow: 'visible' }}>
      <div style={{ ...s.page, flex: 1, marginRight: trayOpen ? drawerWidth : 0 }}>
        <style>{`
          @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
          @keyframes spin    { to { transform: rotate(360deg); } }
          .ins-row:hover { background: var(--surface-2) !important; cursor: pointer; }
        `}</style>

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
            <EmptyState
              icon="📊"
              title="No spending data"
              subtitle="Try adjusting your date range or selecting another account."
            />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={s.chartsGrid}>
              {/* Bar chart */}
              <div style={s.card}>
                <p style={s.cardTitle}>
                  Spend by {groupSingular}
                  <span style={{ fontWeight: 500, color: T.muted, marginLeft: '6px' }}>
                    ({chartData.length} {groupLabel.toLowerCase()})
                  </span>
                </p>
                <div style={{ maxHeight: 420, overflowY: 'auto', overflowX: 'hidden' }}>
                  <ResponsiveContainer width="100%" height={Math.max(260, chartData.length * 38)}>
                    <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 32, top: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={chartC.grid} />
                      <XAxis type="number" tickFormatter={fmtK} tick={{ fontSize: 11, fill: chartC.tick }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: chartC.muted }} axisLine={false} tickLine={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: chartC.cursor }} />
                      <Bar
                        dataKey="total" radius={[0, 6, 6, 0]} maxBarSize={28}
                        onClick={(data) => handleSliceClick(data)}
                        style={{ cursor: 'pointer' }}
                      >
                        {chartData.map((_, i) => <Cell key={i} fill={palette[i % palette.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
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
                        {chartData.map((_, i) => <Cell key={i} fill={palette[i % palette.length]} stroke="none" />)}
                      </Pie>
                      <Tooltip
                        formatter={v => fmt.format(v)}
                        contentStyle={{ borderRadius: '10px', border: `1px solid ${chartC.tooltipBorder}`, background: chartC.tooltipBg, color: chartC.tooltipText, boxShadow: 'var(--shadow-lg)' }}
                        labelStyle={{ color: chartC.tooltipText }}
                        itemStyle={{ color: chartC.tooltipText }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{
                    position: 'absolute', top: '45%', left: '50%',
                    transform: 'translate(-50%, -50%)',
                    textAlign: 'center', pointerEvents: 'none',
                  }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: T.faint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total</div>
                    <div className="tnum" style={{ fontSize: '17px', fontWeight: 800, color: T.text, letterSpacing: '-0.5px' }}>{fmtK(grandTotal)}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px', maxHeight: 96, overflowY: 'auto', paddingRight: '4px' }}>
                  {chartData.map((item, i) => (
                    <div
                      key={i} onClick={() => handleSliceClick(item)}
                      style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: T.muted, cursor: 'pointer' }}
                    >
                      <span style={s.dot(palette[i % palette.length])} />
                      {item.name}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Breakdown table */}
            <div style={s.card}>
              <p style={s.cardTitle}>Full Breakdown</p>
              <div style={s.tableScroll}>
              <table style={s.table}>
                <thead>
                  <tr>
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
                        style={{ background: trayOpen && selectedItem?.name === item.name ? 'var(--primary-light)' : '' }}
                      >
                        <td style={s.td(false)}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={s.dot(palette[i % palette.length])} />
                            <span style={{ color: T.faint, fontWeight: 600, fontSize: '12px' }}>{i + 1}</span>
                          </span>
                        </td>
                        <td style={s.td(false)}>
                          <span style={{ fontWeight: 700, color: T.text }}>{item.name}</span>
                        </td>
                        <td className="tnum" style={{ ...s.td(true), color: T.muted }}>
                          {item.count != null ? item.count.toLocaleString('en-IN') : '—'}
                        </td>
                        <td className="tnum" style={{ ...s.td(true), fontWeight: 700, color: T.red }}>
                          {fmt.format(item.total)}
                        </td>
                        <td style={{ ...s.td(false), width: '120px' }}>
                          <div style={{ height: '6px', background: T.borderSub, borderRadius: '4px', overflow: 'hidden', minWidth: '80px' }}>
                            <div style={{
                              width: barW, height: '100%',
                              background: palette[i % palette.length],
                              borderRadius: '4px', transition: 'width 0.5s ease',
                            }} />
                          </div>
                        </td>
                        <td className="tnum" style={{ ...s.td(true), fontWeight: 700, color: T.text, fontSize: '12px', minWidth: '44px' }}>
                          {share.toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} style={{ padding: '12px 14px', fontWeight: 700, color: T.muted, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.06em', background: T.surface2, boxShadow: `inset 0 2px 0 ${T.border}`, position: 'sticky', bottom: 0, zIndex: 2 }}>
                      Total — {chartData.length} {groupLabel.toLowerCase()}
                    </td>
                    <td className="tnum" style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 800, color: T.text, fontSize: '14px', background: T.surface2, boxShadow: `inset 0 2px 0 ${T.border}`, position: 'sticky', bottom: 0, zIndex: 2 }}>
                      {fmt.format(grandTotal)}
                    </td>
                    <td colSpan={2} style={{ background: T.surface2, boxShadow: `inset 0 2px 0 ${T.border}`, position: 'sticky', bottom: 0, zIndex: 2 }} />
                  </tr>
                </tfoot>
              </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── RHS transaction drawer (docked; page stays interactive) ── */}
      <Drawer
        open={trayOpen}
        onClose={closeTray}
        title={groupSingular ? `${groupSingular} transactions` : 'Transactions'}
        width={drawerWidth}
        onWidthChange={setDrawerWidth}
        modal={false}
      >
        {selectedItem && (
          <>
            {/* Header: identity + totals */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', minWidth: 0 }}>
              <Avatar name={selectedItem.name || '?'} size={44} />
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: T.faint, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {groupSingular}
                </p>
                <h2 style={{ margin: '4px 0 0', fontSize: '18px', fontWeight: 800, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {selectedItem.name}
                </h2>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
              {[
                { label: 'Total',        value: fmt.format(trayTotal) },
                { label: 'Transactions', value: (selectedItem.count ?? txList.length).toLocaleString('en-IN') },
              ].map(stat => (
                <div key={stat.label} style={{ flex: 1, background: T.surface2, borderRadius: '8px', padding: '10px 12px', border: `1px solid ${T.border}` }}>
                  <p style={{ margin: 0, fontSize: '10px', fontWeight: 700, color: T.faint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{stat.label}</p>
                  <p className="tnum" style={{ margin: '3px 0 0', fontSize: '15px', fontWeight: 800, color: T.text }}>{stat.value}</p>
                </div>
              ))}
            </div>

            {/* Transaction list */}
            {txLoading ? (
              <div style={{ padding: '48px 20px', textAlign: 'center' }}>
                <div style={{ width: '28px', height: '28px', borderRadius: '50%', border: `3px solid ${T.indigoDim}`, borderTopColor: 'var(--primary)', animation: 'spin 0.7s linear infinite', margin: '0 auto 12px' }} />
                <p style={{ margin: 0, fontSize: '13px', color: T.muted }}>Loading transactions…</p>
              </div>
            ) : txError ? (
              <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                <p style={{ margin: 0, fontSize: '13px', color: T.red }}>{txError}</p>
              </div>
            ) : txList.length === 0 ? (
              <EmptyState icon="📭" title="No transactions" subtitle="Nothing found for this period." compact />
            ) : (
              <div style={{ margin: '0 -8px' }}>
                {txList.map((tx, i) => (
                  <div
                    key={tx.id ?? i}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '12px',
                      padding: '13px 8px',
                      borderBottom: i < txList.length - 1 ? `1px solid ${T.borderSub}` : 'none',
                    }}
                  >
                    <Avatar name={tx.description || selectedItem.name || '?'} size={36} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {tx.description ?? '—'}
                      </p>
                      <p style={{ margin: '2px 0 0', fontSize: '11px', color: T.muted }}>
                        {fmtDate(tx.date)}
                        {accountMap[tx.accountId] ? ` · ${accountMap[tx.accountId]}` : ''}
                      </p>
                    </div>
                    <p className="tnum" style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: T.red, flexShrink: 0 }}>
                      −{fmtFull.format(tx.amount)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Drawer>
    </div>
  );
}
