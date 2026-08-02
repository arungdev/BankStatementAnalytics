import { useState, useEffect, useCallback, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useAccount } from '../context/useAccount';
import { ALL_ACCOUNTS } from '../components/AccountFilter';
import api from '../api/client';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { FilterGroup, FilterPill, FilterDropdownChip } from '../components/PageHeader';
import StatCard from '../components/StatCard';
import { Avatar, Drawer, EmptyState, useTheme } from "@common/client";
import { getToken } from "../theme/chartTheme";
import { FiDownload, FiCalendar, FiArrowRight } from 'react-icons/fi';
import { currencyFormatter as fmt, maskName } from '../utils/format';
import './Reports.css';

/* ─── Design tokens — mapped to the global CSS variable system. DOM inline
 * styles use var() directly; recharts SVG colors are resolved via getToken. */
const T = {
  indigo:    'var(--primary)',
  indigoDim: 'var(--primary-light)',
  surface:   'var(--surface)',
  bg:        'var(--surface-2)',
  border:    'var(--border-color)',
  borderSub: 'var(--border-subtle)',
  text:      'var(--text-main)',
  muted:     'var(--text-muted)',
  faint:     'var(--text-faint)',
  red:       'var(--danger)',
  green:     'var(--success)',
  greenSoft: '#6ee7b7',
  redSoft:   '#fca5a5',
};

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

/* ─── ReportsFilters — rendered in PageHeader's filter row ──────────────── */
export function ReportsFilters({ reportType, setReportType, reportPeriod, setReportPeriod }) {
  const [periods, setPeriods] = useState({ months: [], years: [] });

  useEffect(() => {
    api.get('/reports/periods')
      .then(res => setPeriods(res.data || { months: [], years: [] }))
      .catch(() => setPeriods({ months: [], years: [] }));
  }, []);

  // Months render under a per-year header with month-only rows; the trigger
  // still shows the full "June 2026" label. Years stay a flat list.
  const options = reportType === 'year'
    ? (periods.years || []).map(y => ({ value: String(y), label: String(y) }))
    : (periods.months || []).map(m => ({
        value: `${m.year}-${m.month}`,
        label: m.label,
        menuLabel: new Date(m.year, m.month - 1, 1).toLocaleString('en-US', { month: 'long' }),
        group: String(m.year),
      }));

  // Keep the selection valid for the active type (e.g. after toggling Month ↔ Year).
  useEffect(() => {
    if (options.length === 0) return;
    if (!options.some(o => o.value === reportPeriod))
      setReportPeriod(options[0].value);
  }, [options, reportPeriod, setReportPeriod]);

  return (
    <>
      <FilterGroup label="Report">
        <FilterPill active={reportType === 'month'} onClick={() => setReportType('month')}>
          Monthly
        </FilterPill>
        <FilterPill active={reportType === 'year'} onClick={() => setReportType('year')}>
          Yearly
        </FilterPill>
      </FilterGroup>

      <FilterGroup style={{ position: 'relative', zIndex: 'var(--z-dropdown)' }}>
        <FilterDropdownChip
          prefix="Period"
          icon={<FiCalendar size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />}
          value={reportPeriod}
          options={options}
          onSelect={setReportPeriod}
          placeholder="No data"
        />
      </FilterGroup>
    </>
  );
}

/* ─── Top merchants list ────────────────────────────────────────────────────
   The API returns the full ranked list; we reveal it a page at a time as the
   pane is scrolled to the bottom. Remounted via `key` when the report params
   change, which resets the page count back to the first slice. */
const MERCHANT_PAGE = 10;

function MerchantList({ merchants, spendTotal }) {
  const [limit, setLimit] = useState(MERCHANT_PAGE);
  const shown = merchants.slice(0, limit);
  const hasMore = limit < merchants.length;

  // Bars are scaled against the leader (so #1 always fills); the caption shows
  // share of total spends — the same denominator as the category table's Share.
  const leader = merchants[0]?.total || 0;

  const onScroll = (e) => {
    if (!hasMore) return;
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight <= 24) {
      setLimit(l => Math.min(l + MERCHANT_PAGE, merchants.length));
    }
  };

  return (
    <div className={`merchant-list${hasMore ? ' has-more' : ''}`}>
      {/* Must stay shorter than one page of rows (~46px each) or the pane never
          overflows, no scrollbar appears, and onScroll can never fire. */}
      <div className="report-scroll merchant-scroll" onScroll={onScroll}>
        {shown.map((m, i) => (
          <div key={m.name} className="merchant-row">
            <span className={`merchant-rank${i < 3 ? ' is-top' : ''}`}>{i + 1}</span>
            <div className="merchant-body">
              <div className="merchant-line">
                <span className="merchant-name">{maskName(m.name)}</span>
                <span className="merchant-amount tnum">{fmt.format(m.total)}</span>
              </div>
              <div className="merchant-meta">
                <div className="merchant-bar">
                  <span
                    className={i < 3 ? undefined : 'is-dim'}
                    style={{ width: `${leader > 0 ? Math.max((m.total / leader) * 100, 2) : 0}%` }}
                  />
                </div>
                <span className="merchant-sub tnum">
                  {spendTotal > 0 ? ((m.total / spendTotal) * 100).toFixed(1) : '0.0'}%
                </span>
                <span className="merchant-sub">·</span>
                <span className="merchant-sub tnum">{m.count} txn</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      {hasMore && (
        <p className="no-print merchant-more">
          Showing {shown.length} of {merchants.length} — scroll for more
        </p>
      )}
    </div>
  );
}

/* ─── Summary tiles ─────────────────────────────────────────────────────────
   Each tile drills down to the rows behind it. `kind` is the filter passed to
   api/reports/transactions; 'all' returns both sides of the ledger, so Net Flow
   and Transactions open the same list under different headings. */
const TILES = {
  income: { kind: 'income', title: 'Income transactions' },
  spend:  { kind: 'spend',  title: 'Spend transactions' },
  net:    { kind: 'all',    title: 'Net flow — all transactions' },
  count:  { kind: 'all',    title: 'All transactions' },
};

/* ─── Main Component ────────────────────────────────────────────────────── */
export default function Reports() {
  const {
    accounts:   accounts   = [],
    reportType: type       = 'month',
    reportPeriod: period   = '',
  } = useOutletContext() ?? {};
  const { selectedAccountId } = useAccount();
  const { theme } = useTheme();

  // Resolved chart colors (recharts SVG can't read CSS var()). Category slots
  // share the same fixed order as Insights so a category keeps its color.
  const palette = useMemo(
    () => [1, 2, 3, 4, 5, 6, 7, 8].map((i) => getToken(`chart-${i}`)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme]
  );
  const chartC = useMemo(() => ({
    grid: getToken('chart-grid'),
    tick: getToken('chart-tick'),
    income: getToken('chart-income'),
    spend: getToken('chart-spend'),
    net: getToken('chart-1'),
    cursor: getToken('primary-light'),
    tooltipBg: getToken('surface'),
    tooltipText: getToken('text-main'),
    tooltipBorder: getToken('border-color'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [theme]);

  const [report, setReport]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Summary-tile drill-down: which tile is open, and the rows behind it.
  // openTileKey pins the drawer to the filters it was opened under, so changing
  // period or account closes it (derived, rather than an effect that resets state).
  const [openTile, setOpenTile]       = useState(null); // key into TILES
  const [openTileKey, setOpenTileKey] = useState('');
  const [drawerWidth, setDrawerWidth] = useState(400);
  const [txList, setTxList]           = useState([]);
  const [txLoading, setTxLoading]     = useState(false);
  const [txError, setTxError]         = useState(null);

  // "All accounts" → every owned account id; otherwise the single selected id.
  const accountIdsParam = useMemo(() => {
    if (selectedAccountId === ALL_ACCOUNTS) return accounts.map(a => a.id).join(',');
    return selectedAccountId ? String(selectedAccountId) : '';
  }, [selectedAccountId, accounts]);

  const scopeLabel = useMemo(() => {
    if (selectedAccountId === ALL_ACCOUNTS) return 'All accounts';
    const acc = accounts.find(a => a.id === selectedAccountId);
    return acc ? `${acc.bankName} ${acc.maskedAccountNumber ?? ''}`.trim() : '';
  }, [selectedAccountId, accounts]);

  // Shared by the JSON fetch and the PDF download; null while the filters are incomplete.
  const buildParams = useCallback(() => {
    if (!accountIdsParam || !period) return null;
    const p = new URLSearchParams();
    p.append('type', type);
    p.append('accountIds', accountIdsParam);
    if (type === 'year') {
      p.append('year', period);
    } else {
      const [y, m] = period.split('-');
      if (!y || !m) return null;
      p.append('year', y);
      p.append('month', m);
    }
    return p;
  }, [accountIdsParam, type, period]);

  const fetchReport = useCallback(() => {
    const p = buildParams();
    if (!p) return;
    setLoading(true);
    api.get(`/reports?${p.toString()}`)
      .then(res => setReport(res.data))
      .catch(err => console.error('Failed to fetch report', err))
      .finally(() => setLoading(false));
  }, [buildParams]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  const paramsKey = `${type}|${period}|${accountIdsParam}`;
  const trayOpen  = openTile != null && openTileKey === paramsKey;

  const closeTray = useCallback(() => {
    setOpenTile(null);
    setTxList([]);
    setTxError(null);
  }, []);

  // Tile click → the rows behind that tile. Same period/account params as the
  // report itself plus a `kind`, so the list reconciles with the tile's total.
  // Clicking the tile that's already open closes the drawer.
  const openTileDrawer = useCallback((key) => {
    if (openTile === key && openTileKey === paramsKey) { closeTray(); return; }

    const p = buildParams();
    if (!p || !TILES[key]) return;
    p.append('kind', TILES[key].kind);

    setOpenTile(key);
    setOpenTileKey(paramsKey);
    setTxLoading(true);
    setTxError(null);
    setTxList([]);

    api.get(`/reports/transactions?${p.toString()}`)
      .then(res => setTxList(Array.isArray(res.data) ? res.data : []))
      .catch(err => {
        console.error('Failed to fetch report transactions', err);
        setTxError('Could not load transactions. Please try again.');
      })
      .finally(() => setTxLoading(false));
  }, [buildParams, openTile, openTileKey, paramsKey, closeTray]);

  const summary    = report?.summary;
  const categories = report?.byCategory ?? [];
  const merchants  = report?.topMerchants ?? [];
  const budgets    = report?.budgets ?? [];
  const bills      = report?.bills ?? [];
  const deposits   = report?.deposits;
  const spendTotal = summary?.totalSpends ?? 0;
  const netPositive = (summary?.net ?? 0) >= 0;

  // Running bank balance at the period edges (null for credit-card-only selections).
  // Its change is computed from the balances themselves, not from Net Flow — the two
  // differ because Net Flow drops own-money transfers and uses effective dates.
  // Drawer footer stats + the bank label shown per row.
  const trayCredits = txList.reduce((sum, t) => sum + t.credit, 0);
  const trayDebits  = txList.reduce((sum, t) => sum + t.debit, 0);
  const accountMap  = useMemo(
    () => accounts.reduce((m, a) => { m[a.id] = a.bankName; return m; }, {}),
    [accounts]
  );

  const openingBal = summary?.openingBalance ?? null;
  const closingBal = summary?.closingBalance ?? openingBal;
  const balanceChange = openingBal == null ? 0 : closingBal - openingBal;
  const isEmpty    = !loading && report && (summary?.transactionCount ?? 0) === 0;

  const s = {
    page: {
      padding: '28px 32px',
      background: T.bg,
      minHeight: '100vh',
      fontFamily: "'Inter', 'system-ui', sans-serif",
    },
    topRow: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: '18px', gap: '12px',
    },
    // Grid rather than a wrapping flex row: when the drill-down drawer narrows the
    // report column the tiles reflow 4 → 2 → 1 evenly, instead of dropping a single
    // tile onto its own full-width line.
    statsRow: {
      display: 'grid', gap: '16px', marginBottom: '20px',
      gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
    },
    balanceBand: {
      display: 'flex', alignItems: 'center', gap: '22px', flexWrap: 'wrap',
      background: T.surface, border: `1px solid ${T.border}`, borderRadius: '14px',
      padding: '14px 22px', marginBottom: '20px', boxShadow: 'var(--shadow-sm)',
    },
    balanceLabel: {
      display: 'block', margin: 0, fontSize: '10px', fontWeight: 700, color: T.faint,
      textTransform: 'uppercase', letterSpacing: '0.07em',
    },
    balanceValue: { display: 'block', margin: '3px 0 0', fontSize: '17px', fontWeight: 800, color: T.text },
    balanceSub: { display: 'block', margin: '2px 0 0', fontSize: '11px', color: T.muted },
    grid: {
      display: 'grid', gridTemplateColumns: '3fr 2fr',
      gap: '20px', marginBottom: '20px', alignItems: 'start',
    },
    card: {
      background: T.surface, borderRadius: '14px',
      padding: '22px 24px', border: `1px solid ${T.border}`,
      boxShadow: 'var(--shadow-sm)',
      marginBottom: '20px',
    },
    cardTitle: { margin: '0 0 18px', fontSize: '13px', fontWeight: 700, color: T.text, letterSpacing: '-0.1px' },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
    th: (right) => ({
      padding: '9px 12px', textAlign: right ? 'right' : 'left',
      fontWeight: 700, color: T.muted, fontSize: '11px',
      textTransform: 'uppercase', letterSpacing: '0.06em',
      background: T.bg, boxShadow: `inset 0 -2px 0 ${T.border}`,
    }),
    td: (right) => ({
      padding: '10px 12px', textAlign: right ? 'right' : 'left',
      borderBottom: `1px solid ${T.borderSub}`, verticalAlign: 'middle',
    }),
    dot: (color) => ({
      display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%',
      background: color, flexShrink: 0, marginRight: '8px',
    }),
    bar: () => ({
      height: '6px', background: T.borderSub, borderRadius: '4px', overflow: 'hidden',
      minWidth: '70px',
    }),
    barFill: (widthPct, color) => ({
      width: `${Math.min(Math.max(widthPct, 2), 100).toFixed(1)}%`,
      height: '100%', background: color, borderRadius: '4px',
    }),
  };

  // Server-rendered PDF (GET api/reports/pdf) fetched as a blob so the session
  // cookie applies, then handed to the browser as a normal file download.
  const downloadPdf = async () => {
    const p = buildParams();
    if (!p) return;
    setDownloading(true);
    try {
      const res = await api.get(`/reports/pdf?${p.toString()}`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${report?.label ?? 'Report'} ${type === 'year' ? 'Annual' : 'Monthly'} Report.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download PDF', err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="report-shell" style={{ display: 'flex', minHeight: '100vh', overflow: 'visible' }}>
      <div
        className="report-page"
        style={{ ...s.page, flex: 1, minWidth: 0, marginRight: trayOpen ? drawerWidth : 0 }}
      >

      {/* ── Toolbar (screen only) ── */}
      <div className="no-print" style={s.topRow}>
        <div>
          <p style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: T.text }}>
            {report?.label ?? '—'} {type === 'year' ? 'Annual' : 'Monthly'} Report
          </p>
          <p style={{ margin: '2px 0 0', fontSize: '12px', color: T.muted }}>{scopeLabel}</p>
        </div>
        <button
          className="btn primary"
          onClick={downloadPdf}
          disabled={!report || loading || downloading}
          style={{ display: 'flex', alignItems: 'center', gap: '7px' }}
          title="Download this report as a PDF file"
        >
          <FiDownload size={15} /> {downloading ? 'Preparing…' : 'Download PDF'}
        </button>
      </div>

      <div className="report-print-area">

        {/* ── Report header (print only) ── */}
        <div className="report-print-header">
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: T.text }}>
            Bank Analytics — {report?.label} {type === 'year' ? 'Annual' : 'Monthly'} Report
          </h1>
          <p style={{ margin: '4px 0 16px', fontSize: '12px', color: T.muted }}>
            {scopeLabel} · Generated {fmtDate(new Date())}
          </p>
        </div>

        {loading ? (
          <div style={{ ...s.card, textAlign: 'center', padding: '60px' }}>
            <p style={{ margin: 0, color: T.muted, fontSize: '13px' }}>Building report…</p>
          </div>
        ) : !report ? (
          <div style={{ ...s.card, padding: 0 }}>
            <EmptyState icon="📄" title="No report" subtitle="Pick a period to generate a report." />
          </div>
        ) : isEmpty ? (
          <div style={{ ...s.card, padding: 0 }}>
            <EmptyState icon="📄" title="Nothing in this period" subtitle="No transactions were found for the selected period and accounts." />
          </div>
        ) : (
          <>
            {/* ── Summary ── */}
            <div className="report-stat-row" style={s.statsRow}>
              <StatCard
                label="Total Income"
                value={fmt.format(summary.totalIncome)}
                valueColor="#34d399"
                onClick={() => openTileDrawer('income')}
                active={trayOpen && openTile === 'income'}
                title="Show the income transactions behind this total"
              />
              <StatCard
                label="Total Spends"
                value={fmt.format(summary.totalSpends)}
                valueColor="#f87171"
                onClick={() => openTileDrawer('spend')}
                active={trayOpen && openTile === 'spend'}
                title="Show the spend transactions behind this total"
              />
              <StatCard
                label="Net Flow"
                value={`${netPositive ? '+' : '−'}${fmt.format(Math.abs(summary.net))}`}
                valueColor={netPositive ? '#34d399' : '#f87171'}
                sub={netPositive ? 'Saved this period' : 'Spent more than earned'}
                accent={netPositive ? T.greenSoft : T.redSoft}
                onClick={() => openTileDrawer('net')}
                active={trayOpen && openTile === 'net'}
                title="Show every transaction in this period"
              />
              <StatCard
                label="Transactions"
                value={summary.transactionCount.toLocaleString('en-IN')}
                onClick={() => openTileDrawer('count')}
                active={trayOpen && openTile === 'count'}
                title="Show every transaction in this period"
              />
            </div>

            {/* ── Balance band — what the account actually held at each edge of the
                period, so the spend totals above have something to sit against. ── */}
            {openingBal != null && (
              <div className="report-card report-balance-band" style={s.balanceBand}>
                <div>
                  <span style={s.balanceLabel}>Opening Balance</span>
                  <span className="tnum" style={s.balanceValue}>{fmt.format(openingBal)}</span>
                  <span style={s.balanceSub}>on {fmtDate(report.startDate)}</span>
                </div>

                <FiArrowRight size={18} style={{ color: T.faint, flexShrink: 0 }} />

                <div>
                  <span style={s.balanceLabel}>Closing Balance</span>
                  <span className="tnum" style={s.balanceValue}>{fmt.format(closingBal)}</span>
                  <span style={s.balanceSub}>on {fmtDate(report.endDate)}</span>
                </div>

                <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                  <span style={s.balanceLabel}>Change</span>
                  <span
                    className="tnum"
                    style={{ ...s.balanceValue, color: balanceChange >= 0 ? T.green : T.red }}
                  >
                    {balanceChange >= 0 ? '+' : '−'}{fmt.format(Math.abs(balanceChange))}
                  </span>
                  <span style={s.balanceSub}>includes transfers &amp; self-payments</span>
                </div>
              </div>
            )}

            {/* ── Month-by-month chart (yearly only) ── */}
            {type === 'year' && report.monthlySeries && (
              <div className="report-card" style={s.card}>
                <p style={s.cardTitle}>Income vs Spends by Month</p>
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart
                    data={report.monthlySeries.map(m => ({ ...m, net: m.income - m.spend }))}
                    margin={{ left: 8, right: 8, top: 4, bottom: 0 }}
                    barGap={2}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartC.grid} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: chartC.tick }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={fmtK} tick={{ fontSize: 11, fill: chartC.tick }} axisLine={false} tickLine={false} />
                    <Tooltip
                      formatter={(v, name) => [fmt.format(v), { income: 'Income', spend: 'Spend', net: 'Net' }[name] ?? name]}
                      contentStyle={{ borderRadius: '10px', border: `1px solid ${chartC.tooltipBorder}`, background: chartC.tooltipBg, color: chartC.tooltipText, boxShadow: 'var(--shadow-lg)', fontSize: '12px' }}
                      labelStyle={{ color: chartC.tooltipText }}
                      itemStyle={{ color: chartC.tooltipText }}
                      cursor={{ fill: chartC.cursor }}
                    />
                    <Legend
                      formatter={v => <span style={{ fontSize: 12, color: T.muted }}>{{ income: 'Income', spend: 'Spend', net: 'Net' }[v] ?? v}</span>}
                    />
                    <Bar dataKey="income" fill={chartC.income} radius={[4, 4, 0, 0]} maxBarSize={20} />
                    <Bar dataKey="spend" fill={chartC.spend} radius={[4, 4, 0, 0]} maxBarSize={20} />
                    <Line type="monotone" dataKey="net" stroke={chartC.net} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* ── Categories + Top merchants ── */}
            <div className="report-grid" style={s.grid}>
              <div className="report-card" style={{ ...s.card, marginBottom: 0 }}>
                <p style={s.cardTitle}>Spend by Category</p>
                {categories.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '13px', color: T.muted }}>No spending in this period.</p>
                ) : (
                  <table style={s.table}>
                    <thead>
                      <tr>
                        <th style={s.th(false)}>Category</th>
                        <th style={s.th(true)}>Txns</th>
                        <th style={s.th(true)}>Spend</th>
                        <th style={s.th(false)} />
                        <th style={s.th(true)}>Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categories.map((c, i) => {
                        const share = spendTotal > 0 ? (c.total / spendTotal) * 100 : 0;
                        return (
                          <tr key={c.name}>
                            <td style={s.td(false)}>
                              <span style={s.dot(palette[i % palette.length])} />
                              <span style={{ fontWeight: 700, color: T.text }}>{c.name}</span>
                            </td>
                            <td className="tnum" style={{ ...s.td(true), color: T.muted }}>{c.count}</td>
                            <td className="tnum" style={{ ...s.td(true), fontWeight: 700, color: T.red }}>{fmt.format(c.total)}</td>
                            <td style={{ ...s.td(false), width: '110px' }}>
                              <div style={s.bar()}>
                                <div style={s.barFill(share, palette[i % palette.length])} />
                              </div>
                            </td>
                            <td style={{ ...s.td(true), fontWeight: 700, fontSize: '12px' }}>{share.toFixed(1)}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td style={{ padding: '11px 12px', fontWeight: 700, color: T.muted, fontSize: '12px', textTransform: 'uppercase' }}>Total</td>
                        <td />
                        <td style={{ padding: '11px 12px', textAlign: 'right', fontWeight: 800, color: T.text }}>{fmt.format(spendTotal)}</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>

              <div className="report-card" style={{ ...s.card, marginBottom: 0 }}>
                <p style={s.cardTitle}>
                  Top Merchants
                  {merchants.length > 0 && (
                    <span style={{ fontWeight: 500, color: T.muted, marginLeft: '6px' }}>
                      ({merchants.length})
                    </span>
                  )}
                </p>
                {merchants.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '13px', color: T.muted }}>No merchant spending in this period.</p>
                ) : (
                  <MerchantList
                    key={`${type}-${period}-${accountIdsParam}`}
                    merchants={merchants}
                    spendTotal={spendTotal}
                  />
                )}
              </div>
            </div>

            {/* ── Budget performance ── */}
            {budgets.length > 0 && (
              <div className="report-card" style={s.card}>
                <p style={s.cardTitle}>
                  Budget Performance
                  <span style={{ fontWeight: 500, color: T.muted, marginLeft: '6px' }}>
                    (all accounts{type === 'year' ? ', limits × months elapsed' : ''})
                  </span>
                </p>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th(false)}>Category</th>
                      <th style={s.th(true)}>Budget</th>
                      <th style={s.th(true)}>Spent</th>
                      <th style={s.th(true)}>Remaining</th>
                      <th style={s.th(false)} />
                      <th style={s.th(true)}>Used</th>
                    </tr>
                  </thead>
                  <tbody>
                    {budgets.map(b => (
                      <tr key={b.category}>
                        <td style={{ ...s.td(false), fontWeight: 700, color: T.text }}>{b.category}</td>
                        <td style={{ ...s.td(true), color: T.muted }}>{fmt.format(b.limit)}</td>
                        <td style={{ ...s.td(true), fontWeight: 700, color: b.overBudget ? T.red : T.text }}>{fmt.format(b.spent)}</td>
                        <td style={{ ...s.td(true), color: b.remaining < 0 ? T.red : T.green, fontWeight: 600 }}>
                          {fmt.format(b.remaining)}
                        </td>
                        <td style={{ ...s.td(false), width: '130px' }}>
                          <div style={s.bar()}>
                            <div style={s.barFill(b.percent, b.overBudget ? T.red : b.percent > 80 ? 'var(--warning)' : T.green)} />
                          </div>
                        </td>
                        <td style={{ ...s.td(true), fontWeight: 700, fontSize: '12px', color: b.overBudget ? T.red : T.text }}>
                          {b.percent.toFixed(0)}%{b.overBudget ? ' ⚠' : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Bills paid ── */}
            {bills.length > 0 && (
              <div className="report-card" style={s.card}>
                <p style={s.cardTitle}>
                  Bills Paid
                  <span style={{ fontWeight: 500, color: T.muted, marginLeft: '6px' }}>(all accounts)</span>
                </p>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th(false)}>Bill</th>
                      <th style={s.th(true)}>Expected</th>
                      <th style={s.th(true)}>Payments</th>
                      <th style={s.th(true)}>Total Paid</th>
                      <th style={s.th(true)}>Last Paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bills.map(b => (
                      <tr key={b.name}>
                        <td style={{ ...s.td(false), fontWeight: 700, color: T.text }}>{b.name}</td>
                        <td style={{ ...s.td(true), color: T.muted }}>{fmt.format(b.expectedAmount)}</td>
                        <td style={{ ...s.td(true), color: T.muted }}>{b.paidCount}</td>
                        <td style={{ ...s.td(true), fontWeight: 700, color: T.text }}>{fmt.format(b.totalPaid)}</td>
                        <td style={{ ...s.td(true), color: T.muted }}>{fmtDate(b.lastPaidDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Deposits ── */}
            {deposits?.items?.length > 0 && (
              <div className="report-card" style={s.card}>
                <p style={s.cardTitle}>Deposits &amp; Investments</p>
                <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
                  {[
                    { label: 'RD Invested', value: deposits.rdInvested },
                    { label: 'FD Placed', value: deposits.fdPlaced },
                    { label: 'FD Returns', value: deposits.fdReturns },
                  ].filter(c => c.value > 0).map(c => (
                    <div key={c.label} style={{
                      background: T.bg, border: `1px solid ${T.border}`, borderRadius: '8px',
                      padding: '8px 14px',
                    }}>
                      <p style={{ margin: 0, fontSize: '10px', fontWeight: 700, color: T.faint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {c.label}
                      </p>
                      <p style={{ margin: '2px 0 0', fontSize: '14px', fontWeight: 800, color: T.text }}>{fmt.format(c.value)}</p>
                    </div>
                  ))}
                </div>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th(false)}>Deposit</th>
                      <th style={s.th(false)}>Type</th>
                      <th style={s.th(true)}>Invested</th>
                      <th style={s.th(true)}>Returns</th>
                      <th style={s.th(true)}>Installments</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deposits.items.map(d => (
                      <tr key={`${d.kind}-${d.name}`}>
                        <td style={{ ...s.td(false), fontWeight: 700, color: T.text }}>{d.name}</td>
                        <td style={{ ...s.td(false), color: T.muted }}>{d.kind}</td>
                        <td style={{ ...s.td(true), fontWeight: 700, color: T.text }}>{d.invested > 0 ? fmt.format(d.invested) : '—'}</td>
                        <td style={{ ...s.td(true), color: d.returns > 0 ? T.green : T.muted, fontWeight: 600 }}>
                          {d.returns > 0 ? fmt.format(d.returns) : '—'}
                        </td>
                        <td style={{ ...s.td(true), color: T.muted }}>{d.kind === 'RD' ? d.installments : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
      </div>

      {/* ── RHS drill-down drawer (docked; the report behind stays interactive) ── */}
      <Drawer
        open={trayOpen}
        onClose={closeTray}
        title={openTile ? TILES[openTile].title : 'Transactions'}
        width={drawerWidth}
        onWidthChange={setDrawerWidth}
        modal={false}
      >
        <div style={{ display: 'flex', gap: '8px', marginBottom: '18px' }}>
          {[
            { label: 'Rows', value: txList.length.toLocaleString('en-IN') },
            { label: 'Credits', value: fmt.format(trayCredits), color: T.green },
            { label: 'Debits', value: fmt.format(trayDebits), color: T.red },
          ].map(stat => (
            <div key={stat.label} style={{ flex: 1, background: T.bg, borderRadius: '8px', padding: '10px 12px', border: `1px solid ${T.border}` }}>
              <p style={{ margin: 0, fontSize: '10px', fontWeight: 700, color: T.faint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{stat.label}</p>
              <p className="tnum" style={{ margin: '3px 0 0', fontSize: '14px', fontWeight: 800, color: stat.color || T.text }}>{stat.value}</p>
            </div>
          ))}
        </div>

        {txLoading ? (
          <div style={{ padding: '48px 20px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: '13px', color: T.muted }}>Loading transactions…</p>
          </div>
        ) : txError ? (
          <div style={{ padding: '40px 20px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: '13px', color: T.red }}>{txError}</p>
          </div>
        ) : txList.length === 0 ? (
          <EmptyState icon="📭" title="No transactions" subtitle="Nothing found for this tile." compact />
        ) : (
          <div style={{ margin: '0 -8px' }}>
            {txList.map((tx, i) => {
              const credit = tx.credit > 0;
              const label = tx.merchant || tx.description || '—';
              return (
                <div
                  key={tx.id || i}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 8px',
                    borderBottom: i < txList.length - 1 ? `1px solid ${T.borderSub}` : 'none',
                  }}
                >
                  <Avatar name={maskName(label)} size={34} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {maskName(label)}
                    </p>
                    <p style={{ margin: '2px 0 0', fontSize: '11px', color: T.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {fmtDate(tx.date)}
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
          </div>
        )}
      </Drawer>
    </div>
  );
}
