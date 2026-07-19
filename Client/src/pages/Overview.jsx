import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useAccount } from '../context/useAccount';
import { ALL_ACCOUNTS } from '../components/AccountFilter';
import api from '../api/client';
import StatCard from '../components/StatCard';
import CreditCardPanel from '../components/CreditCardPanel';
import EmptyState from '../components/ui/EmptyState';
import useTheme from '../context/useTheme';
import { getToken } from '../theme/chartTheme';
import { currencyFormatter as fmt, formatDate, maskName } from '../utils/format';

/* ─── Design tokens — mapped to the global CSS variable system ───────────── */
const T = {
  indigo:     'var(--primary)',
  indigoDim:  'var(--primary-light)',
  indigoSoft: 'var(--stat-tile-label)',
  surface:    'var(--surface)',
  bg:         'var(--bg)',
  border:     'var(--border-color)',
  borderSub:  'var(--border-subtle)',
  text:       'var(--text-main)',
  muted:      'var(--text-muted)',
  faint:      'var(--text-faint)',
  red:        'var(--danger)',
  green:      'var(--success)',
};

const s = {
  page: {
    padding: '28px 32px',
    background: T.bg,
    minHeight: '100vh',
  },
  statsRow: { display: 'flex', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' },
  grid: {
    display: 'grid',
    gridTemplateColumns: '3fr 4fr',
    gap: '20px',
  },
  card: {
    background: T.surface,
    borderRadius: '14px',
    padding: '22px 24px',
    border: `1px solid ${T.border}`,
    boxShadow: 'var(--shadow-sm)',
  },
  cardTitle: {
    margin: '0 0 18px',
    fontSize: '13px',
    fontWeight: 700,
    color: T.text,
    letterSpacing: '-0.1px',
  },
};

// Deterministic avatar color per merchant name, so the list scans by color+initials.
const hueOf = name => {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
};
const initialsOf = name =>
  name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

const fmtK = v => v >= 100000
  ? `₹${(v / 100000).toFixed(1)}L`
  : v >= 1000
  ? `₹${(v / 1000).toFixed(0)}k`
  : `₹${v}`;

const Skeleton = ({ w = '100%', h = 16, r = 6 }) => (
  <div style={{
    width: w, height: h, borderRadius: r,
    background: 'linear-gradient(90deg, var(--gray-100) 25%, var(--gray-200) 50%, var(--gray-100) 75%)',
    backgroundSize: '200% 100%',
    animation: 'shimmer 1.4s infinite',
  }} />
);

export default function Overview() {
  const { selectedAccountId } = useAccount();
  const { accounts = [], openSettings } = useOutletContext() ?? {};
  const navigate = useNavigate();
  const { theme } = useTheme();
  const [data, setData] = useState(null);
  const [trend, setTrend] = useState([]);
  const [loading, setLoading] = useState(false);

  // Resolved chart colors (recharts SVG can't read CSS var()). `theme` is the
  // trigger: getToken() reads resolved values off the DOM, so recompute on flip.
  const chartC = useMemo(() => ({
    income: getToken('chart-income'),
    spend: getToken('chart-spend'),
    grid: getToken('chart-grid'),
    tick: getToken('chart-tick'),
    tooltipBg: getToken('surface'),
    tooltipText: getToken('text-main'),
    tooltipBorder: getToken('border-color'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [theme]);

  const fetchOverview = useCallback(() => {
    if (!selectedAccountId) { setData(null); setTrend([]); return; }
    // "All accounts" aggregates across every owned account; otherwise a single id.
    const isAll = selectedAccountId === ALL_ACCOUNTS;
    const allIds = accounts.map(a => a.id).join(',');
    if (isAll && !allIds) { setData(null); setTrend([]); return; }
    const query = isAll ? `accountIds=${allIds}` : `accountId=${selectedAccountId}`;
    // Cash-flow curve covers the last 6 calendar months, inclusive of this one.
    const now = new Date();
    const trendStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const startParam = `${trendStart.getFullYear()}-${String(trendStart.getMonth() + 1).padStart(2, '0')}-01`;
    setLoading(true);
    Promise.all([
      api.get(`/dashboard?${query}`),
      api.get(`/trends?${query}&period=month&startDate=${startParam}`),
    ])
      .then(([dash, tr]) => {
        setData(dash.data);
        setTrend(Array.isArray(tr.data) ? tr.data : []);
      })
      .catch(err => { console.error('Failed to fetch overview', err); setData(null); setTrend([]); })
      .finally(() => setLoading(false));
  }, [selectedAccountId, accounts]);

  useEffect(() => { fetchOverview(); }, [fetchOverview]);

  const totalIncome = data?.totalIncome ?? 0;
  const totalSpends = data?.totalSpends ?? 0;
  const netFlow     = totalIncome - totalSpends;
  const netPositive = netFlow >= 0;
  const topMerchants = data?.topMerchants ?? [];
  const recent       = data?.recentTransactions ?? [];
  const maxMerchant  = topMerchants.reduce((m, x) => Math.max(m, x.amount), 0);

  const isEmpty = !loading && data && (data.totalTransactions ?? 0) === 0;

  // Credit-card-only panel: statement dues, utilization, cycle spend.
  const selectedAccount = selectedAccountId !== ALL_ACCOUNTS
    ? accounts.find(a => a.id === selectedAccountId)
    : null;
  const isCreditCard = selectedAccount?.bankName === 'HDFCCreditCard';

  return (
    <div style={s.page}>
      <style>{`
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        .ov-row { transition: background .15s ease; }
        .ov-row:hover { background: var(--gray-50); }
        .ov-viewall { transition: color .15s ease; }
        .ov-viewall:hover { color: var(--primary-hover); text-decoration: underline; }
      `}</style>

      {/* ── Stat cards ── */}
      <div style={s.statsRow}>
        <StatCard
          label="Total Income"
          value={loading ? '—' : fmt.format(totalIncome)}
          valueColor="#34d399"
        />
        <StatCard
          label="Total Spends"
          value={loading ? '—' : fmt.format(totalSpends)}
          valueColor="#f87171"
        />
        <StatCard
          label="Net Flow"
          value={loading ? '—' : `${netPositive ? '+' : ''}${fmt.format(netFlow)}`}
          valueColor={netPositive ? '#34d399' : '#f87171'}
          sub={loading ? '' : (netPositive ? 'Positive cash flow' : 'Negative cash flow')}
          accent={netPositive ? '#34d399' : '#f87171'}
        />
        <StatCard
          label="Transactions"
          value={loading ? '—' : (data?.totalTransactions ?? 0).toLocaleString('en-IN')}
          accent={T.indigoSoft}
        />
      </div>

      {isCreditCard && (
        <CreditCardPanel accountId={selectedAccountId} onOpenSettings={openSettings} />
      )}

      {!selectedAccountId ? (
        <div style={s.card}>
          <EmptyState icon="🏦" title="No account selected" subtitle="Pick an account from the header to see its overview." />
        </div>
      ) : isEmpty ? (
        <div style={s.card}>
          <EmptyState icon="📊" title="No transactions yet" subtitle="Upload a statement to see your income, spends, and top merchants here." />
        </div>
      ) : (
        <>
        {/* ── Cash-flow curve (last 6 months) ── */}
        {!loading && trend.length > 1 && (
          <div style={{ ...s.card, marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <p style={{ ...s.cardTitle, margin: 0 }}>Cash Flow · last {trend.length} months</p>
              <div style={{ display: 'flex', gap: '16px', fontSize: '12px', fontWeight: 500, color: T.muted }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: chartC.income }} /> Income
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: chartC.spend }} /> Spend
                </span>
              </div>
            </div>
            <div style={{ marginTop: '16px' }}>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={trend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="ovIncomeFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={chartC.income} stopOpacity={0.18} />
                      <stop offset="100%" stopColor={chartC.income} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="ovSpendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={chartC.spend} stopOpacity={0.18} />
                      <stop offset="100%" stopColor={chartC.spend} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartC.grid} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: chartC.tick }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={fmtK} tick={{ fontSize: 11, fill: chartC.tick }} axisLine={false} tickLine={false} width={54} />
                  <Tooltip
                    formatter={(v, name) => [fmt.format(v), name === 'income' ? 'Income' : 'Spend']}
                    cursor={{ stroke: chartC.grid, strokeWidth: 1 }}
                    contentStyle={{ borderRadius: '10px', border: `1px solid ${chartC.tooltipBorder}`, background: chartC.tooltipBg, color: chartC.tooltipText, boxShadow: 'var(--shadow-lg)', fontSize: '12px' }}
                    labelStyle={{ color: chartC.tooltipText }}
                    itemStyle={{ color: chartC.tooltipText }}
                  />
                  <Area type="monotone" dataKey="income" stroke={chartC.income} strokeWidth={2} fill="url(#ovIncomeFill)" dot={false} activeDot={{ r: 4, strokeWidth: 2 }} />
                  <Area type="monotone" dataKey="spend" stroke={chartC.spend} strokeWidth={2} fill="url(#ovSpendFill)" dot={false} activeDot={{ r: 4, strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div style={s.grid}>
          {/* ── Top merchants ── */}
          <div style={s.card}>
            <p style={s.cardTitle}>Top Merchants</p>
            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {[...Array(5)].map((_, i) => <Skeleton key={i} h={20} />)}
              </div>
            ) : topMerchants.length === 0 ? (
              <EmptyState icon="🏬" title="No merchant spend" subtitle="Nothing to rank yet." compact />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {topMerchants.map((m, i) => {
                  const pct = maxMerchant > 0 ? (m.amount / maxMerchant) * 100 : 0;
                  return (
                    <div
                      key={i}
                      onClick={() => navigate('/insights')}
                      title="View spending insights"
                      style={{ cursor: 'pointer' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', marginBottom: '5px' }}>
                        <span style={{
                          fontSize: '13px', fontWeight: 600, color: T.text,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {maskName(m.name)}
                        </span>
                        <span className="tnum" style={{ fontSize: '13px', fontWeight: 700, color: T.red, flexShrink: 0 }}>
                          {fmt.format(m.amount)}
                        </span>
                      </div>
                      <div style={{ height: '7px', background: T.borderSub, borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{
                          width: `${Math.max(pct, 2)}%`, height: '100%',
                          background: T.indigo, borderRadius: '4px', transition: 'width 0.5s ease',
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Recent transactions ── */}
          <div style={s.card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <p style={{ ...s.cardTitle, margin: 0 }}>Recent Activity</p>
              <button
                className="ov-viewall"
                onClick={() => navigate('/transactions')}
                style={{
                  border: 'none', background: 'none', padding: 0, cursor: 'pointer',
                  fontSize: '12px', fontWeight: 600, color: T.indigo,
                }}
              >
                View all →
              </button>
            </div>
            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {[...Array(5)].map((_, i) => <Skeleton key={i} h={20} />)}
              </div>
            ) : recent.length === 0 ? (
              <EmptyState icon="📭" title="No recent transactions" subtitle="Nothing to show yet." compact />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {recent.map((tx, i) => {
                  const income = tx.amount >= 0;
                  const name = maskName(tx.name) || '—';
                  const hue = hueOf(name);
                  const dark = theme === 'dark';
                  const avatarBg = income
                    ? 'var(--success-light)'
                    : dark ? `hsl(${hue} 70% 60% / 0.18)` : `hsl(${hue} 70% 45% / 0.10)`;
                  const avatarFg = income
                    ? T.green
                    : dark ? `hsl(${hue} 75% 72%)` : `hsl(${hue} 55% 38%)`;
                  return (
                    <div
                      key={tx.id ?? i}
                      className="ov-row"
                      onClick={() => navigate('/transactions')}
                      title="View in Transactions"
                      style={{
                        display: 'flex', alignItems: 'center', gap: '12px',
                        padding: '9px 10px', margin: '0 -10px',
                        borderRadius: '10px', cursor: 'pointer',
                      }}
                    >
                      <div style={{
                        width: '38px', height: '38px', borderRadius: '12px',
                        background: avatarBg, color: avatarFg,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, fontSize: '12px', fontWeight: 700, letterSpacing: '0.3px',
                      }}>
                        {income ? '↓' : initialsOf(name)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{
                          margin: 0, fontSize: '13px', fontWeight: 600, color: T.text,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {name}
                        </p>
                        <p style={{
                          margin: '3px 0 0', fontSize: '11px', color: T.muted,
                          display: 'flex', alignItems: 'center', gap: '6px',
                        }}>
                          <span>{tx.date ? formatDate(tx.date) : '—'}</span>
                          {tx.mode && (
                            <span style={{
                              fontSize: '9.5px', fontWeight: 600, letterSpacing: '0.5px',
                              padding: '1.5px 7px', borderRadius: '999px',
                              background: 'var(--gray-100)', color: T.muted,
                            }}>
                              {tx.mode}
                            </span>
                          )}
                        </p>
                      </div>
                      <p className="tnum" style={{
                        margin: 0, fontSize: '13px', fontWeight: 700, flexShrink: 0,
                        color: income ? T.green : T.text,
                      }}>
                        {income ? '+' : '−'}{fmt.format(Math.abs(tx.amount))}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        </>
      )}
    </div>
  );
}
