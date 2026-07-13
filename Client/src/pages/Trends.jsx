import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useAccount } from '../context/useAccount';
import { ALL_ACCOUNTS } from '../components/AccountFilter';
import api from '../api/client';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
// ── Same DateRangePicker component used on the Insights page ────────────
import DateRangePicker from '../components/Daterangepicker';
import { FilterGroup, FilterPill } from '../components/PageHeader';
import StatCard from '../components/StatCard';
import EmptyState from '../components/ui/EmptyState';
import Drawer from '../components/ui/Drawer';
import useTheme from '../context/useTheme';
import { getToken } from '../theme/chartTheme';
import { currencyFormatter, isAmountMasked } from '../utils/format';
import './Trends.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

// chart.js paints on a canvas and can't consume CSS var()s, so chart colors
// are resolved from tokens at render time. rgba variants drive the gradients.
const hexToRgba = (hex, a) => {
  const h = (hex || '').replace('#', '');
  const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const r = parseInt(n.slice(0, 2), 16) || 0;
  const g = parseInt(n.slice(2, 4), 16) || 0;
  const b = parseInt(n.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${a})`;
};

// ── Vertical fill gradient (top vivid → bottom soft), cached per canvas ─────
const gradientCache = new WeakMap();
const makeFill = (top, bottom) => (ctx) => {
  const { ctx: g, chartArea } = ctx.chart;
  if (!chartArea) return top;
  let byKey = gradientCache.get(g);
  if (!byKey) { byKey = {}; gradientCache.set(g, byKey); }
  const key = `${top}|${bottom}|${Math.round(chartArea.top)}|${Math.round(chartArea.bottom)}`;
  if (!byKey[key]) {
    const grad = g.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    byKey[key] = grad;
  }
  return byKey[key];
};

const formatShort = (v) => {
  if (isAmountMasked()) return '••';
  if (v >= 10000000) return (v / 10000000).toFixed(1) + 'Cr';
  if (v >= 100000)   return (v / 100000).toFixed(2) + 'L';
  if (v >= 1000)     return (v / 1000).toFixed(1) + 'k';
  return v;
};

const VISIBLE_GROUPS = 8;

/* ─── TrendsFilters — rendered in Layout's PageHeader filter row ───────── */
export function TrendsFilters({ period, setPeriod, dateRange, setDateRange }) {
  return (
    <>
      <FilterGroup style={{ position: 'relative', zIndex: 500 }}>
        <DateRangePicker
          value={dateRange}
          onChange={setDateRange}
          showTime={false}
          align="left"
          placeholder="All Time"
        />
      </FilterGroup>

      <FilterGroup label="View">
        {['day', 'week', 'month'].map(p => (
          <FilterPill key={p} active={period === p} onClick={() => setPeriod(p)}>
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </FilterPill>
        ))}
      </FilterGroup>
    </>
  );
}

const Trends = () => {
  const {
    accounts:     accounts    = [],
    trendsPeriod: period       = 'week',
    trendsRange:  dateRange    = { start: null, end: null, preset: 'ALL' },
  } = useOutletContext() ?? {};

  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const { selectedAccountId } = useAccount();
  const { theme } = useTheme();
  const isAllAccounts = selectedAccountId === ALL_ACCOUNTS;

  // Resolved chart colors — recomputed whenever the theme flips.
  const C = useMemo(() => {
    const income = getToken('chart-income');
    const spend  = getToken('chart-spend');
    return {
      green: income,
      greenTop: hexToRgba(income, 0.95),
      greenBottom: hexToRgba(income, 0.55),
      greenHover: income,
      red: spend,
      redTop: hexToRgba(spend, 0.92),
      redBottom: hexToRgba(spend, 0.52),
      redHover: spend,
      grid: getToken('chart-grid'),
      tickColor: getToken('chart-tick'),
      tooltipBg: '#1e293b',
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  const [visibleRange, setVisibleRange] = useState({ start: 0, end: Infinity });
  const scrollRef   = useRef(null);
  const debounceRef = useRef(null);
  const barGroupWidth = period === 'day' ? 84 : 62;

  // ── Drill-down modal state ─────────────────────────────────────────────
  const [drillDown, setDrillDown]           = useState(null);
  const [drillTransactions, setDrillTransactions] = useState([]);
  const [drillLoading, setDrillLoading]     = useState(false);
  const [drillWidth, setDrillWidth]         = useState(720);

  // ── Helper: Date → "yyyy-MM-dd" string in local time ──────────────────
  const toLocalDate = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // ── Fetch ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedAccountId) { setLoading(false); setData([]); return; }

    // "All accounts" aggregates across every owned account; otherwise a single id.
    const allIds = accounts.map(a => a.id).join(',');
    if (isAllAccounts && !allIds) { setLoading(false); setData([]); return; }
    setLoading(true);

    const { start: startDate, end: endDate } = dateRange;

    const params = new URLSearchParams({ period });
    if (isAllAccounts) params.append('accountIds', allIds);
    else               params.append('accountId', selectedAccountId);
    if (startDate) params.append('startDate', toLocalDate(startDate));
    if (endDate)   params.append('endDate',   toLocalDate(endDate));

    api.get(`/trends?${params.toString()}`)
      .then(res => {
        let rows = Array.isArray(res.data) ? res.data : [];

        // Client-side safety net: drop rows outside the selected range.
        if (startDate || endDate) {
          const fromStr = startDate ? toLocalDate(startDate) : null;
          const toStr   = endDate   ? toLocalDate(endDate)   : null;

          rows = rows.filter(item => {
            const d = item.date; // "yyyy-MM-dd" from backend
            if (!d) return true;
            if (fromStr && d < fromStr) return false;
            if (toStr   && d > toStr)   return false;
            return true;
          });
        }

        setData(rows);
      })
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [period, selectedAccountId, dateRange, accounts, isAllAccounts]);

  useEffect(() => {
    setVisibleRange({ start: 0, end: Math.min(VISIBLE_GROUPS, data.length) });
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  }, [data]);

  // ── Scroll → visible range ─────────────────────────────────────────────
  const handleScroll = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!scrollRef.current || !data.length) return;
      const { scrollLeft, clientWidth } = scrollRef.current;
      const start = Math.max(0, Math.floor(scrollLeft / barGroupWidth) - 1);
      const end   = Math.min(data.length, Math.ceil((scrollLeft + clientWidth) / barGroupWidth) + 1);
      setVisibleRange({ start, end });
    }, 40);
  }, [data.length, barGroupWidth]);

  // ── Dynamic Y-max ──────────────────────────────────────────────────────
  const visibleYMax = useMemo(() => {
    if (!data.length) return 100;
    const slice = data.slice(visibleRange.start, visibleRange.end);
    const max   = slice.reduce((m, d) => Math.max(m, d.income, d.spend), 0);
    return max > 0 ? max * 1.18 : 100;
  }, [data, visibleRange]);

  // ── Summary ────────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    if (!data.length) return { totalIncome: 0, totalSpends: 0, netFlow: 0 };
    const totalIncome = data.reduce((s, d) => s + d.income, 0);
    const totalSpends = data.reduce((s, d) => s + d.spend,  0);
    return { totalIncome, totalSpends, netFlow: totalIncome - totalSpends };
  }, [data]);

  // ── Compute date range for a clicked bucket ────────────────────────────
  const getBucketRange = useCallback((item) => {
    const [y, m, d] = item.date.split('-').map(Number);
    const start = new Date(y, m - 1, d);
    let end;

    if (period === 'day') {
      end = new Date(start);
    } else if (period === 'week') {
      end = new Date(start);
      end.setDate(end.getDate() + 6);
    } else {
      end = new Date(y, m, 0); // last day of that month
    }

    return { startDate: toLocalDate(start), endDate: toLocalDate(end) };
  }, [period]);

  // ── Handle bar click → fetch transactions for that bucket ──────────────
  const handleBarClick = useCallback((evt, elements) => {
    if (!elements.length || !selectedAccountId) return;
    const index = elements[0].index;
    const item  = data[index];
    if (!item) return;

    const { startDate: bStart, endDate: bEnd } = getBucketRange(item);

    setDrillDown({ label: item.label, date: item.date, start: bStart, end: bEnd });
    setDrillLoading(true);
    setDrillTransactions([]);

    const params = new URLSearchParams({ startDate: bStart, endDate: bEnd, pageSize: 0 });

    // The statements endpoint is single-account, so for "all" we fan out over
    // every account and merge the bucket's transactions.
    const idsToFetch = isAllAccounts ? accounts.map(a => a.id) : [selectedAccountId];

    Promise.all(
      idsToFetch.map(id =>
        api.get(`/statements/${id}?${params.toString()}`)
          .then(res => res.data?.transactions || [])
          .catch(() => [])
      )
    )
      .then(results => setDrillTransactions(results.flat()))
      .catch(() => setDrillTransactions([]))
      .finally(() => setDrillLoading(false));
  }, [data, selectedAccountId, isAllAccounts, accounts, getBucketRange]);

  const closeDrillDown = () => {
    setDrillDown(null);
    setDrillTransactions([]);
  };

  // ── Shared Y scale factory ─────────────────────────────────────────────
  const makeYScale = (showTicks) => ({
    beginAtZero: true,
    max: visibleYMax,
    grid: { color: C.grid, borderDash: [3, 5], drawTicks: false },
    ticks: showTicks
      ? { callback: formatShort, maxTicksLimit: 5, font: { size: 10.5, family: "'Inter'" }, color: C.tickColor, padding: 6 }
      : { display: false },
    border: { display: false },
  });

  // ── Left Y-axis-only chart ─────────────────────────────────────────────
  const axisData = {
    labels: [''],
    datasets: [{ data: [0], backgroundColor: 'transparent', borderWidth: 0 }],
  };
  const axisOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 350, easing: 'easeOutQuart' },
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: {
      y: makeYScale(true),
      x: { grid: { display: false }, ticks: { display: false }, border: { display: false } },
    },
    layout: { padding: { bottom: 24 } },
  };

  // ── Main bars chart ────────────────────────────────────────────────────
  const mainData = useMemo(() => ({
    labels: data.map(d => d.label),
    datasets: [
      {
        label: 'Spends',
        data: data.map(d => d.spend),
        backgroundColor: makeFill(C.redTop, C.redBottom),
        hoverBackgroundColor: C.redHover,
        borderRadius: { topLeft: 6, topRight: 6 },
        borderSkipped: false,
        maxBarThickness: 30,
        categoryPercentage: 0.68,
        barPercentage: 0.92,
      },
      {
        label: 'Income',
        data: data.map(d => d.income),
        backgroundColor: makeFill(C.greenTop, C.greenBottom),
        hoverBackgroundColor: C.greenHover,
        borderRadius: { topLeft: 6, topRight: 6 },
        borderSkipped: false,
        maxBarThickness: 30,
        categoryPercentage: 0.68,
        barPercentage: 0.92,
      },
    ],
  }), [data, C]);

  const mainOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 350, easing: 'easeOutQuart' },
    onClick: handleBarClick,
    onHover: (evt, elements) => {
      if (evt.native?.target) {
        evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
      }
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: C.tooltipBg,
        borderColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        padding: 13,
        cornerRadius: 10,
        titleColor: '#f1f5f9',
        bodyColor: '#94a3b8',
        titleFont: { size: 12, weight: '600', family: "'Inter'" },
        bodyFont: { size: 12, family: "'Inter'" },
        callbacks: {
          label: ctx => `  ${ctx.dataset.label}  ${currencyFormatter.format(ctx.parsed.y)}`,
          afterBody: (items) => {
            if (items.length < 2) return [];
            const spend  = items.find(i => i.dataset.label === 'Spends')?.parsed.y ?? 0;
            const income = items.find(i => i.dataset.label === 'Income')?.parsed.y ?? 0;
            const net    = income - spend;
            return [`  Net  ${net >= 0 ? '+' : ''}${currencyFormatter.format(net)}`, '  Click bar for transactions'];
          },
        },
      },
    },
    scales: {
      y: makeYScale(false),
      x: {
        grid: { display: false },
        ticks: { font: { size: 10.5, family: "'Inter'" }, color: C.tickColor, maxRotation: 0 },
        border: { display: false },
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [visibleYMax, handleBarClick, C]);

  // ── Render helpers ─────────────────────────────────────────────────────
  const renderChart = () => {
    if (loading) {
      return (
        <div className="chart-loader">
          <div className="loader-spinner" />
          <span>Loading data…</span>
        </div>
      );
    }
    if (!data.length) {
      return (
        <div className="chart-empty">
          <EmptyState
            icon="📈"
            title="No data for this period"
            subtitle="Select an account or adjust the date range."
          />
        </div>
      );
    }

    return (
      <div className="split-chart-container">
        <div className="y-axis-panel">
          <Bar key={theme} data={axisData} options={axisOptions} />
        </div>
        <div className="bars-scroll-panel" ref={scrollRef} onScroll={handleScroll}>
          <div style={{ position: 'relative', height: '100%', minWidth: `max(100%, ${data.length * barGroupWidth}px)` }}>
            <Bar key={theme} data={mainData} options={mainOptions} />
          </div>
        </div>
      </div>
    );
  };

  const netPositive = summary.netFlow >= 0;

  // ── Drill-down totals ──────────────────────────────────────────────────
  const drillTotals = useMemo(() => {
    if (!drillTransactions.length) return { income: 0, spend: 0 };
    return drillTransactions.reduce((acc, t) => {
      acc.income += t.Credit ?? t.credit ?? 0;
      acc.spend  += t.Debit  ?? t.debit  ?? 0;
      return acc;
    }, { income: 0, spend: 0 });
  }, [drillTransactions]);

  return (
    <div
      className="trends-container"
      style={{ marginRight: drillDown ? drillWidth : 0, transition: 'margin-right 0.2s ease' }}
    >

      {/* Summary cards */}
      <div className="summary-stats">
        <StatCard
          label="Total Income"
          value={currencyFormatter.format(summary.totalIncome)}
          valueColor="#34d399"
        />
        <StatCard
          label="Total Spends"
          value={currencyFormatter.format(summary.totalSpends)}
          valueColor="#f87171"
        />
        <StatCard
          label="Net Flow"
          value={`${netPositive ? '+' : ''}${currencyFormatter.format(summary.netFlow)}`}
          valueColor={netPositive ? '#34d399' : '#f87171'}
          sub={netPositive ? 'Positive cash flow' : 'Negative cash flow'}
          accent={netPositive ? '#34d399' : '#f87171'}
        />
      </div>

      {/* Chart */}
      <div className="trends-chart-card">
        <div className="trends-chart-header">
          <h2 className="chart-card-title">Income vs. Spends</h2>
          <div className="chart-legend">
            <div><span className="legend-dot spend" /> Spends</div>
            <div><span className="legend-dot income" /> Income</div>
          </div>
        </div>
        <div className="chart-wrapper">{renderChart()}</div>
      </div>

      {/* Drill-down — RHS slide-in drawer (shared shell with Transactions) */}
      <Drawer
        open={!!drillDown}
        onClose={closeDrillDown}
        title={drillDown?.label || ''}
        width={drillWidth}
        onWidthChange={setDrillWidth}
        minWidth={420}
        modal={false}
      >
        {drillDown && (
          <>
            <div className="drilldown-range-row">{drillDown.start} → {drillDown.end}</div>

            {!drillLoading && drillTransactions.length > 0 && (
              <div className="drilldown-summary">
                <div>
                  <span className="drilldown-summary-label">Income</span>
                  <span className="drilldown-summary-value income">{currencyFormatter.format(drillTotals.income)}</span>
                </div>
                <div>
                  <span className="drilldown-summary-label">Spends</span>
                  <span className="drilldown-summary-value spend">{currencyFormatter.format(drillTotals.spend)}</span>
                </div>
                <div>
                  <span className="drilldown-summary-label">Net</span>
                  <span className={`drilldown-summary-value ${drillTotals.income - drillTotals.spend >= 0 ? 'income' : 'spend'}`}>
                    {drillTotals.income - drillTotals.spend >= 0 ? '+' : ''}{currencyFormatter.format(drillTotals.income - drillTotals.spend)}
                  </span>
                </div>
              </div>
            )}

            <div className="drilldown-body">
              {drillLoading ? (
                <div className="chart-loader">
                  <div className="loader-spinner" />
                  <span>Loading transactions…</span>
                </div>
              ) : drillTransactions.length === 0 ? (
                <div className="chart-empty">
                  <EmptyState icon="📭" title="No transactions found" subtitle={`for ${drillDown.label}.`} compact />
                </div>
              ) : (
                <div className="drill-cards">
                  {drillTransactions.map((t, i) => {
                    const debit    = t.Debit    ?? t.debit    ?? 0;
                    const credit   = t.Credit   ?? t.credit   ?? 0;
                    const date     = t.TransactionDate ?? t.transactionDate;
                    const desc     = t.Description    ?? t.description;
                    const merchant = t.Merchant       ?? t.merchant;
                    const isCredit = credit > 0;
                    const amount   = isCredit ? credit : debit;
                    const name     = merchant && merchant !== '-' ? merchant : (desc || '—');
                    const initials = name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
                    const hue      = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
                    return (
                      <div className="drill-card" key={t.Id ?? t.id ?? i}>
                        <div
                          className="drill-card-avatar"
                          style={{ background: `hsl(${hue} 70% 92%)`, color: `hsl(${hue} 55% 38%)` }}
                        >
                          {initials}
                        </div>
                        <div className="drill-card-main">
                          <div className="drill-card-merchant" title={name}>{name}</div>
                          {desc && desc !== name && (
                            <div className="drill-card-desc" title={desc}>{desc}</div>
                          )}
                          <div className="drill-card-date">
                            {date ? new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}
                          </div>
                        </div>
                        <div className={`drill-card-amount ${isCredit ? 'income' : 'spend'}`}>
                          {isCredit ? '+' : '-'}{currencyFormatter.format(amount)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </Drawer>

    </div>
  );
};

export default Trends;