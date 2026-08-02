import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useAccount } from '../context/useAccount';
import { ALL_ACCOUNTS } from '../components/AccountFilter';
import api from '../api/client';
import StatCard from '../components/StatCard';
import CreditCardPanel from '../components/CreditCardPanel';
import { Avatar, Drawer, EmptyState, useTheme } from "@common/client";
import { getToken } from "../theme/chartTheme";
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
  // The feed card owns its own height so the list scrolls instead of the page.
  feedCard: { display: 'flex', flexDirection: 'column', position: 'relative', minHeight: 0 },
};

// Deterministic avatar color per merchant name, so the list scans by color+initials.
const hueOf = name => {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
};
const initialsOf = name =>
  name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

// Rows per activity-feed page — matches RecentPageSize on the server.
const RECENT_PAGE = 10;

// Rows per drill-down page — matches TilePageSize on the server. The Overview
// scope is the account's whole history, so the drawer pages rather than loading
// every row the way the date-bounded Trends/Reports drawers can.
const TILE_PAGE = 50;

/* Each summary tile drills down to the rows behind it. `kind` is the filter
   passed to api/dashboard/transactions: the money tiles exclude own-money
   transfers (as their totals do), while 'all' counts every row — which is why
   Net Flow and Transactions open different lists. */
const TILES = {
  income: { kind: 'income', title: 'Income transactions' },
  spend:  { kind: 'spend',  title: 'Spend transactions' },
  net:    { kind: 'net',    title: 'Net flow — income and spends' },
  count:  { kind: 'all',    title: 'All transactions' },
};

// Feed rows are grouped by day, so the row itself carries no date — the sticky
// header does. Anything inside the current week reads better as a word.
const dayLabel = iso => {
  if (!iso) return 'Undated';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Undated';
  const midnight = x => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const now = new Date();
  const diff = Math.round((midnight(now) - midnight(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
};

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
  // Activity feed pages in 10 at a time as the user scrolls; the first page
  // rides along with the dashboard payload.
  const [recent, setRecent] = useState([]);
  const [recentHasMore, setRecentHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

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

  // "All accounts" aggregates across every owned account; otherwise a single id.
  // Shared by the overview fetch and the activity feed's paging requests.
  const scopeQuery = useMemo(() => {
    if (!selectedAccountId) return null;
    if (selectedAccountId !== ALL_ACCOUNTS) return `accountId=${selectedAccountId}`;
    const allIds = accounts.map(a => a.id).join(',');
    return allIds ? `accountIds=${allIds}` : null;
  }, [selectedAccountId, accounts]);

  // Latest scope, readable from async callbacks without re-creating them.
  const scopeRef = useRef(scopeQuery);
  useEffect(() => { scopeRef.current = scopeQuery; }, [scopeQuery]);

  const fetchOverview = useCallback(() => {
    if (!scopeQuery) { setData(null); setTrend([]); setRecent([]); setRecentHasMore(false); return; }
    // Cash-flow curve covers the last 6 calendar months, inclusive of this one.
    const now = new Date();
    const trendStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const startParam = `${trendStart.getFullYear()}-${String(trendStart.getMonth() + 1).padStart(2, '0')}-01`;
    setLoading(true);
    Promise.all([
      api.get(`/dashboard?${scopeQuery}`),
      api.get(`/trends?${scopeQuery}&period=month&startDate=${startParam}`),
    ])
      .then(([dash, tr]) => {
        setData(dash.data);
        setTrend(Array.isArray(tr.data) ? tr.data : []);
        setRecent(dash.data?.recentTransactions ?? []);
        setRecentHasMore(!!dash.data?.recentHasMore);
      })
      .catch(err => {
        console.error('Failed to fetch overview', err);
        setData(null); setTrend([]); setRecent([]); setRecentHasMore(false);
      })
      .finally(() => setLoading(false));
  }, [scopeQuery]);

  useEffect(() => { fetchOverview(); }, [fetchOverview]);

  const totalIncome = data?.totalIncome ?? 0;
  const totalSpends = data?.totalSpends ?? 0;
  const netFlow     = totalIncome - totalSpends;
  const netPositive = netFlow >= 0;
  const topMerchants = data?.topMerchants ?? [];
  const maxMerchant  = topMerchants.reduce((m, x) => Math.max(m, x.amount), 0);

  const isEmpty = !loading && data && (data.totalTransactions ?? 0) === 0;

  // Tiles only drill down once there are rows behind them to show.
  const tilesClickable = !loading && !!data && (data.totalTransactions ?? 0) > 0;

  // Recent activity, bucketed by day with a per-day net so the sticky headers
  // carry information rather than just separating rows.
  const recentDays = useMemo(() => {
    const byDay = new Map();
    for (const tx of recent) {
      const key = tx.date ? String(tx.date).slice(0, 10) : 'undated';
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(tx);
    }
    return [...byDay.entries()].map(([key, items]) => ({
      key,
      label: dayLabel(items[0]?.date),
      net: items.reduce((sum, t) => sum + (t.amount ?? 0), 0),
      items,
    }));
  }, [recent]);

  // Bottom fade is a scroll affordance — hide it once the feed is at the end.
  const [feedScrollable, setFeedScrollable] = useState(false);
  const feedNodeRef = useRef(null);
  const sentinelRef = useRef(null);
  // Re-runs when the day buckets change (account switch, page appended) —
  // React 19 ref cleanup detaches the old listener first, so none pile up.
  const feedRef = useCallback(node => {
    feedNodeRef.current = node;
    if (!node) return undefined;
    const sync = () => {
      const more = node.scrollHeight - node.clientHeight - node.scrollTop > 8;
      setFeedScrollable(prev => (prev === more ? prev : more));
    };
    sync();
    node.addEventListener('scroll', sync, { passive: true });
    return () => node.removeEventListener('scroll', sync);
    // recentDays isn't read here — it's the trigger that re-measures the feed
    // after the content changes height.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentDays]);

  const loadMoreRecent = useCallback(() => {
    if (!scopeQuery || !recentHasMore || loadingMore) return;
    const requestScope = scopeQuery;
    setLoadingMore(true);
    api.get(`/dashboard/recent?${scopeQuery}&skip=${recent.length}&take=${RECENT_PAGE}`)
      .then(res => {
        // A page in flight when the account changed belongs to the old feed.
        if (scopeRef.current !== requestScope) return;
        setRecent(prev => [...prev, ...(res.data?.items ?? [])]);
        setRecentHasMore(!!res.data?.hasMore);
      })
      .catch(err => { console.error('Failed to load more activity', err); setRecentHasMore(false); })
      .finally(() => setLoadingMore(false));
  }, [scopeQuery, recentHasMore, loadingMore, recent.length]);

  // Infinite scroll: fire when the sentinel below the last row nears the
  // bottom of the feed's own viewport (not the page's).
  useEffect(() => {
    const root = feedNodeRef.current;
    const target = sentinelRef.current;
    if (!root || !target) return undefined;
    const io = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) loadMoreRecent(); },
      { root, rootMargin: '120px' },
    );
    io.observe(target);
    return () => io.disconnect();
  }, [loadMoreRecent]);

  // ── Summary-tile drill-down ────────────────────────────────────────────
  // openTileScope pins the drawer to the account scope it was opened under, so
  // switching accounts closes it (derived, rather than an effect that resets state).
  const [openTile, setOpenTile]         = useState(null); // key into TILES
  const [openTileScope, setOpenTileScope] = useState('');
  const [drawerWidth, setDrawerWidth]   = useState(420);
  const [tileRows, setTileRows]         = useState([]);
  const [tileStats, setTileStats]       = useState({ total: 0, credits: 0, debits: 0 });
  const [tileHasMore, setTileHasMore]   = useState(false);
  const [tileLoading, setTileLoading]   = useState(false);
  const [tileLoadingMore, setTileLoadingMore] = useState(false);
  const [tileError, setTileError]       = useState(null);

  const trayOpen = openTile != null && openTileScope === scopeQuery;

  const closeTray = useCallback(() => {
    setOpenTile(null);
    setTileRows([]);
    setTileHasMore(false);
    setTileError(null);
  }, []);

  // Tile click → the rows behind that tile. Clicking the open tile closes it.
  const openTileDrawer = useCallback((key) => {
    if (openTile === key && openTileScope === scopeQuery) { closeTray(); return; }
    if (!scopeQuery || !TILES[key]) return;

    setOpenTile(key);
    setOpenTileScope(scopeQuery);
    setTileLoading(true);
    setTileError(null);
    setTileRows([]);
    setTileHasMore(false);

    api.get(`/dashboard/transactions?${scopeQuery}&kind=${TILES[key].kind}&skip=0&take=${TILE_PAGE}`)
      .then(res => {
        setTileRows(res.data?.items ?? []);
        setTileHasMore(!!res.data?.hasMore);
        setTileStats({
          total: res.data?.total ?? 0,
          credits: res.data?.credits ?? 0,
          debits: res.data?.debits ?? 0,
        });
      })
      .catch(err => {
        console.error('Failed to fetch tile transactions', err);
        setTileError('Could not load transactions. Please try again.');
      })
      .finally(() => setTileLoading(false));
  }, [scopeQuery, openTile, openTileScope, closeTray]);

  // Latest tile, readable from an in-flight request without re-creating it.
  const tileRef = useRef(openTile);
  useEffect(() => { tileRef.current = openTile; }, [openTile]);

  const loadMoreTile = useCallback(() => {
    if (!trayOpen || !tileHasMore || tileLoading || tileLoadingMore) return;
    const requestScope = scopeQuery;
    const requestTile = openTile;
    setTileLoadingMore(true);
    api.get(`/dashboard/transactions?${scopeQuery}&kind=${TILES[openTile].kind}&skip=${tileRows.length}&take=${TILE_PAGE}`)
      .then(res => {
        // A page in flight when the scope or tile changed belongs to the old list.
        if (scopeRef.current !== requestScope || tileRef.current !== requestTile) return;
        setTileRows(prev => [...prev, ...(res.data?.items ?? [])]);
        setTileHasMore(!!res.data?.hasMore);
      })
      .catch(err => { console.error('Failed to load more tile transactions', err); setTileHasMore(false); })
      .finally(() => setTileLoadingMore(false));
  }, [trayOpen, tileHasMore, tileLoading, tileLoadingMore, scopeQuery, openTile, tileRows.length]);

  // Read by the observer, so it doesn't have to be rebuilt on every page.
  const loadMoreTileRef = useRef(loadMoreTile);
  useEffect(() => { loadMoreTileRef.current = loadMoreTile; }, [loadMoreTile]);

  // Infinite scroll inside the drawer: the sentinel sits below the last row and
  // trips a little before it comes into view, so the next page lands without a gap.
  const tileSentinelRef = useCallback(node => {
    if (!node) return undefined;
    const io = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) loadMoreTileRef.current(); },
      { rootMargin: '120px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  const accountMap = useMemo(
    () => accounts.reduce((m, a) => { m[a.id] = a.bankName; return m; }, {}),
    [accounts]
  );

  // Credit-card-only panel: statement dues, utilization, cycle spend.
  const selectedAccount = selectedAccountId !== ALL_ACCOUNTS
    ? accounts.find(a => a.id === selectedAccountId)
    : null;
  const isCreditCard = selectedAccount?.bankName === 'HDFCCreditCard';

  return (
    <div style={{ ...s.page, marginRight: trayOpen ? drawerWidth : 0, transition: 'margin-right 0.2s ease' }}>
      <style>{`
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        .ov-row { transition: background .15s ease; }
        .ov-row:hover { background: var(--gray-50); }
        .ov-viewall { transition: color .15s ease; }
        .ov-viewall:hover { color: var(--primary-hover); text-decoration: underline; }

        .ov-feed {
          overflow-y: auto;
          overscroll-behavior: contain;
          scrollbar-width: thin;
          scrollbar-color: var(--gray-300) transparent;
          margin: 0 -10px;
          padding: 0 10px;
        }
        .ov-feed::-webkit-scrollbar        { width: 6px; }
        .ov-feed::-webkit-scrollbar-track  { background: transparent; }
        .ov-feed::-webkit-scrollbar-thumb  { background: var(--gray-300); border-radius: 10px; }
        .ov-feed::-webkit-scrollbar-thumb:hover { background: var(--gray-400); }

        /* Rows scroll beneath the day header, so it needs an opaque backdrop. */
        .ov-day {
          position: sticky; top: 0; z-index: 1;
          display: flex; align-items: center; justify-content: space-between; gap: 10px;
          margin: 0 -10px;
          padding: 7px 10px 6px;
          background: var(--surface);
          border-bottom: 1px solid var(--border-subtle);
          font-size: 10.5px; font-weight: 700; letter-spacing: .5px;
          text-transform: uppercase; color: var(--text-faint);
        }
        .ov-fade {
          position: absolute; left: 1px; right: 1px; bottom: 1px; height: 44px;
          border-radius: 0 0 14px 14px; pointer-events: none;
          background: linear-gradient(to top, var(--surface), transparent);
          opacity: 0; transition: opacity .18s ease;
        }
        .ov-fade[data-show="1"] { opacity: 1; }

        /* The floor that decides when the tile row wraps. Below the 190px default,
           so all four stay on one row once the drill-down drawer docks and narrows
           the page — a tile left alone on the last row would stretch full width. */
        .ov-stat-row > .stat-card { min-width: 150px; }
      `}</style>

      {/* ── Stat cards ── */}
      <div className="ov-stat-row" style={s.statsRow}>
        <StatCard
          label="Total Income"
          value={loading ? '—' : fmt.format(totalIncome)}
          valueColor="#34d399"
          onClick={tilesClickable ? () => openTileDrawer('income') : undefined}
          active={trayOpen && openTile === 'income'}
          title="Show the income transactions behind this total"
        />
        <StatCard
          label="Total Spends"
          value={loading ? '—' : fmt.format(totalSpends)}
          valueColor="#f87171"
          onClick={tilesClickable ? () => openTileDrawer('spend') : undefined}
          active={trayOpen && openTile === 'spend'}
          title="Show the spend transactions behind this total"
        />
        <StatCard
          label="Net Flow"
          value={loading ? '—' : `${netPositive ? '+' : ''}${fmt.format(netFlow)}`}
          valueColor={netPositive ? '#34d399' : '#f87171'}
          sub={loading ? '' : (netPositive ? 'Positive cash flow' : 'Negative cash flow')}
          accent={netPositive ? '#34d399' : '#f87171'}
          onClick={tilesClickable ? () => openTileDrawer('net') : undefined}
          active={trayOpen && openTile === 'net'}
          title="Show the income and spend transactions behind this total"
        />
        <StatCard
          label="Transactions"
          value={loading ? '—' : (data?.totalTransactions ?? 0).toLocaleString('en-IN')}
          accent={T.indigoSoft}
          onClick={tilesClickable ? () => openTileDrawer('count') : undefined}
          active={trayOpen && openTile === 'count'}
          title="Show every transaction on this account"
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
          <div style={{ ...s.card, ...s.feedCard }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
              <p style={{ ...s.cardTitle, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                Recent Activity
                {!loading && recent.length > 0 && (
                  <span style={{
                    fontSize: '10.5px', fontWeight: 700, color: T.muted,
                    padding: '2px 7px', borderRadius: '999px',
                    background: 'var(--gray-100)',
                  }}>
                    {recent.length}
                  </span>
                )}
              </p>
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
              <div ref={feedRef} className="ov-feed" style={{ maxHeight: '392px' }}>
                {recentDays.map(day => (
                  <div key={day.key}>
                    <div className="ov-day">
                      <span>{day.label}</span>
                      <span className="tnum" style={{
                        letterSpacing: 0,
                        color: day.net >= 0 ? T.green : T.red,
                      }}>
                        {day.net >= 0 ? '+' : '−'}{fmt.format(Math.abs(day.net))}
                      </span>
                    </div>
                    {day.items.map((tx, i) => {
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
                          key={tx.id ?? `${day.key}-${i}`}
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
                              {tx.mode ? (
                                <span style={{
                                  fontSize: '9.5px', fontWeight: 600, letterSpacing: '0.5px',
                                  padding: '1.5px 7px', borderRadius: '999px',
                                  background: 'var(--gray-100)', color: T.muted,
                                }}>
                                  {tx.mode}
                                </span>
                              ) : (
                                <span>{tx.date ? formatDate(tx.date) : '—'}</span>
                              )}
                            </p>
                          </div>
                          <p className="tnum" style={{
                            margin: 0, fontSize: '13px', fontWeight: 700, flexShrink: 0,
                            color: income ? T.green : T.red,
                          }}>
                            {income ? '+' : '−'}{fmt.format(Math.abs(tx.amount))}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                ))}

                {/* Paging foot: the sentinel trips the observer a little before
                    it scrolls into view, so the next 10 land without a gap. */}
                {recentHasMore && (
                  <div ref={sentinelRef} style={{ padding: '2px 0 6px' }}>
                    {loadingMore && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '10px 0 4px' }}>
                        <Skeleton h={20} />
                        <Skeleton h={20} />
                      </div>
                    )}
                  </div>
                )}
                {!recentHasMore && recent.length > RECENT_PAGE && (
                  <p style={{
                    margin: '10px 0 2px', textAlign: 'center',
                    fontSize: '11px', fontWeight: 600, color: T.muted,
                  }}>
                    You're all caught up
                  </p>
                )}
              </div>
            )}
            <div className="ov-fade" data-show={feedScrollable ? '1' : '0'} />
          </div>
        </div>
        </>
      )}

      {/* ── Tile drill-down — RHS docked drawer (the page behind stays usable) ── */}
      <Drawer
        open={trayOpen}
        onClose={closeTray}
        title={openTile ? TILES[openTile].title : 'Transactions'}
        width={drawerWidth}
        onWidthChange={setDrawerWidth}
        minWidth={420}
        modal={false}
      >
        {/* Stats cover the whole tile, not just the rows loaded so far. */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '18px' }}>
          {[
            { label: 'Rows', value: tileStats.total.toLocaleString('en-IN') },
            { label: 'Credits', value: fmt.format(tileStats.credits), color: T.green },
            { label: 'Debits', value: fmt.format(tileStats.debits), color: T.red },
          ].map(stat => (
            <div key={stat.label} style={{ flex: 1, background: T.bg, borderRadius: '8px', padding: '10px 12px', border: `1px solid ${T.border}` }}>
              <p style={{ margin: 0, fontSize: '10px', fontWeight: 700, color: T.faint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{stat.label}</p>
              <p className="tnum" style={{ margin: '3px 0 0', fontSize: '14px', fontWeight: 800, color: stat.color || T.text }}>{stat.value}</p>
            </div>
          ))}
        </div>

        {tileLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[...Array(6)].map((_, i) => <Skeleton key={i} h={20} />)}
          </div>
        ) : tileError ? (
          <div style={{ padding: '40px 20px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: '13px', color: T.red }}>{tileError}</p>
          </div>
        ) : tileRows.length === 0 ? (
          <EmptyState icon="📭" title="No transactions" subtitle="Nothing found for this tile." compact />
        ) : (
          <div style={{ margin: '0 -8px' }}>
            {tileRows.map((tx, i) => {
              const credit = tx.credit > 0;
              const label = maskName(tx.merchant || tx.description || '—');
              return (
                <div
                  key={tx.id ? `${tx.id}-${tx.accountId}-${i}` : i}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 8px',
                    borderBottom: i < tileRows.length - 1 ? `1px solid ${T.borderSub}` : 'none',
                  }}
                >
                  <Avatar name={label} size={34} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {label}
                    </p>
                    <p style={{ margin: '2px 0 0', fontSize: '11px', color: T.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {tx.date ? formatDate(tx.date) : '—'}
                      {tx.category ? ` · ${tx.category}` : ''}
                      {accountMap[tx.accountId] ? ` · ${accountMap[tx.accountId]}` : ''}
                    </p>
                  </div>
                  <p className="tnum" style={{ margin: 0, fontSize: '13px', fontWeight: 700, flexShrink: 0, color: credit ? T.green : T.red }}>
                    {credit ? '+' : '−'}{fmt.format(credit ? tx.credit : tx.debit)}
                  </p>
                </div>
              );
            })}

            {tileHasMore ? (
              <div ref={tileSentinelRef} style={{ padding: '2px 0 6px' }}>
                {tileLoadingMore && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '12px 8px 4px' }}>
                    <Skeleton h={20} />
                    <Skeleton h={20} />
                  </div>
                )}
              </div>
            ) : tileRows.length > TILE_PAGE && (
              <p style={{ margin: '12px 0 2px', textAlign: 'center', fontSize: '11px', fontWeight: 600, color: T.muted }}>
                That's all {tileRows.length.toLocaleString('en-IN')} transactions
              </p>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
