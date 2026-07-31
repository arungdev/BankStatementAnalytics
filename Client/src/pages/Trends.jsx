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
import { useChartTheme } from '../theme/chartTheme';
import { currencyFormatter, isAmountMasked, isNameMasked, maskName } from '../utils/format';
import './Trends.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

// chart.js paints on a canvas and can't consume CSS var()s, so chart colors
// are resolved from tokens at render time (useChartTheme).
const hexToRgba = (hex, a) => {
  const h = (hex || '').replace('#', '');
  const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const r = parseInt(n.slice(0, 2), 16) || 0;
  const g = parseInt(n.slice(2, 4), 16) || 0;
  const b = parseInt(n.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${a})`;
};

// Round an axis max up to a clean tick step (1/2/2.5/5 × 10^n) so the y-axis
// reads 10k/20k/30k instead of raw values like 28.9k.
const niceScale = (rawMax) => {
  if (!(rawMax > 0)) return { max: 100, step: 25 };
  const headroom = rawMax * 1.08;
  const target = headroom / 4; // aim for ~4 intervals
  const pow = 10 ** Math.floor(Math.log10(target));
  const mult = [1, 2, 2.5, 5, 10].find(c => c * pow >= target);
  const step = mult * pow;
  return { max: Math.ceil(headroom / step) * step, step };
};

// Compact tick labels — trailing zeros stripped ("2.5L", "3L", "10k").
const trimZeros = (s) => s.replace(/\.?0+$/, '');
const formatShort = (v) => {
  if (isAmountMasked()) return '••';
  if (v >= 10000000) return trimZeros((v / 10000000).toFixed(2)) + 'Cr';
  if (v >= 100000)   return trimZeros((v / 100000).toFixed(2)) + 'L';
  if (v >= 1000)     return trimZeros((v / 1000).toFixed(1)) + 'k';
  return v;
};

const VISIBLE_GROUPS = 8;

// Per-period column width. Wide enough that the bar pair reads as two solid
// marks and the two-line date tick never collides with its neighbour.
const GROUP_WIDTH = { day: 84, week: 74, month: 96 };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Shared by both canvases (bars + the standalone y-axis) so they reserve the
// same x-axis footer height — see axisOptions.
const X_TICKS = {
  font: { size: 11, family: "'Inter'" },
  padding: 10,
  maxRotation: 0,
  autoSkip: false,
};

// Hovering anywhere in a column tints the whole column, so the pair of bars
// under the tooltip reads as one bucket. Drawn under the bars, inside the plot.
const hoverBandPlugin = {
  id: 'hoverBand',
  beforeDatasetsDraw(chart, _args, opts) {
    const active = chart.getActiveElements?.() ?? [];
    if (!active.length || !opts?.color) return;
    const { ctx, chartArea, scales } = chart;
    const x = scales.x;
    const idx = active[0].index;
    const step = x.getPixelForValue(1) - x.getPixelForValue(0);
    const width = (step > 0 ? step : chartArea.width) * 0.9;
    const cx = x.getPixelForValue(idx);

    const height = chartArea.bottom - chartArea.top;
    ctx.save();
    ctx.fillStyle = opts.color;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(cx - width / 2, chartArea.top, width, height, 8);
      ctx.fill();
    } else {
      ctx.fillRect(cx - width / 2, chartArea.top, width, height);
    }
    ctx.restore();
  },
};

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
  const isAllAccounts = selectedAccountId === ALL_ACCOUNTS;

  // Theme-resolved chart colors — shared token hook, recomputed on theme flip.
  const T = useChartTheme();
  const { theme } = T;

  const [visibleRange, setVisibleRange] = useState({ start: 0, end: Infinity });
  // Which side still has off-screen columns — drives the edge fades.
  const [edges, setEdges] = useState({ left: false, right: false });
  const scrollRef   = useRef(null);
  const debounceRef = useRef(null);
  const barGroupWidth = GROUP_WIDTH[period] ?? 74;

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

  const syncEdges = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setEdges({
      left:  el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  }, []);

  // Land on the most recent buckets — that's what the reader came to check.
  useEffect(() => {
    setVisibleRange({ start: Math.max(0, data.length - VISIBLE_GROUPS), end: data.length });
    if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    const id = requestAnimationFrame(syncEdges);
    return () => cancelAnimationFrame(id);
  }, [data, syncEdges]);

  // ── Scroll → visible range ─────────────────────────────────────────────
  const handleScroll = useCallback(() => {
    syncEdges();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!scrollRef.current || !data.length) return;
      const { scrollLeft, clientWidth } = scrollRef.current;
      const start = Math.max(0, Math.floor(scrollLeft / barGroupWidth) - 1);
      const end   = Math.min(data.length, Math.ceil((scrollLeft + clientWidth) / barGroupWidth) + 1);
      setVisibleRange({ start, end });
    }, 40);
  }, [data.length, barGroupWidth, syncEdges]);

  // ── Axis + tooltip labels ──────────────────────────────────────────────
  // Ticks are two lines: the bucket on top, its month/year underneath and only
  // where it changes — so "W 08/02, W 15/02, W 22/02" collapses to 08 / 15 / 22
  // under a single "Feb". Tooltips and the drawer keep the full, spelled-out date.
  const { tickLabels, fullLabels } = useMemo(() => {
    let lastGroup = null;
    const ticks = [];
    const full  = [];

    data.forEach((d) => {
      const [y, m, day] = (d.date || '').split('-').map(Number);
      if (!y) { ticks.push(d.label); full.push(d.label); return; }

      if (period === 'month') {
        ticks.push([MONTHS[m - 1], lastGroup === y ? '' : String(y)]);
        full.push(`${MONTHS[m - 1]} ${y}`);
        lastGroup = y;
        return;
      }

      const key = `${y}-${m}`;
      ticks.push([String(day).padStart(2, '0'), key === lastGroup ? '' : MONTHS[m - 1]]);
      full.push(period === 'week'
        ? `Week of ${String(day).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`
        : `${String(day).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`);
      lastGroup = key;
    });

    return { tickLabels: ticks, fullLabels: full };
  }, [data, period]);

  // ── Dynamic Y-scale — nice round max/step for the visible slice ─────────
  const yScale = useMemo(() => {
    if (!data.length) return niceScale(0);
    const slice = data.slice(visibleRange.start, visibleRange.end);
    const max   = slice.reduce((m, d) => Math.max(m, d.income, d.spend), 0);
    return niceScale(max);
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

    setDrillDown({ label: fullLabels[index] ?? item.label, date: item.date, start: bStart, end: bEnd });
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
  }, [data, selectedAccountId, isAllAccounts, accounts, getBucketRange, fullLabels]);

  const closeDrillDown = useCallback(() => {
    setDrillDown(null);
    setDrillTransactions([]);
  }, []);

  // ── Summary tile click → every transaction behind that tile ────────────
  // Unlike the per-bar drill-down (one bucket, via api/statements) this spans the
  // whole selected range and goes through api/trends/transactions, which applies
  // the same filters as the bars — so the drawer's totals match the tile's.
  const TILE_LABELS = { income: 'Total Income', spend: 'Total Spends', all: 'Net Flow' };

  const handleTileClick = useCallback((kind) => {
    if (!selectedAccountId) return;
    if (drillDown?.kind === kind) { closeDrillDown(); return; }

    const startStr = dateRange.start ? toLocalDate(dateRange.start) : null;
    const endStr   = dateRange.end   ? toLocalDate(dateRange.end)   : null;

    setDrillDown({
      label: TILE_LABELS[kind],
      kind,
      start: startStr ?? 'Earliest',
      end:   endStr   ?? 'Latest',
    });
    setDrillLoading(true);
    setDrillTransactions([]);

    const params = new URLSearchParams({ kind });
    if (isAllAccounts) params.append('accountIds', accounts.map(a => a.id).join(','));
    else               params.append('accountId', selectedAccountId);
    if (startStr) params.append('startDate', startStr);
    if (endStr)   params.append('endDate',   endStr);

    api.get(`/trends/transactions?${params.toString()}`)
      .then(res => setDrillTransactions(Array.isArray(res.data) ? res.data : []))
      .catch(err => {
        console.error('Failed to fetch trend transactions', err);
        setDrillTransactions([]);
      })
      .finally(() => setDrillLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId, isAllAccounts, accounts, dateRange, drillDown, closeDrillDown]);

  // ── Shared Y scale factory — solid hairline grid, clean round ticks ─────
  const makeYScale = (showTicks) => ({
    beginAtZero: true,
    max: yScale.max,
    grid: { color: T.grid, drawTicks: false },
    ticks: showTicks
      ? { callback: formatShort, stepSize: yScale.step, font: { size: 10.5, family: "'Inter'" }, color: T.axisTick, padding: 6 }
      : { display: false },
    border: { display: false },
  });

  // ── Left Y-axis-only chart ─────────────────────────────────────────────
  // Its x-axis carries an invisible two-line tick in the same font as the bars
  // chart, so chart.js reserves exactly the same footer height on both canvases
  // and the gridlines line up without a hand-tuned padding constant.
  const axisData = {
    labels: [['', '']],
    datasets: [{ data: [0], backgroundColor: 'transparent', borderWidth: 0 }],
  };
  const axisOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 350, easing: 'easeOutQuart' },
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: {
      y: makeYScale(true),
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: { ...X_TICKS, color: 'transparent' },
      },
    },
  };

  // ── Main bars chart ────────────────────────────────────────────────────
  // Thin solid bars: rounded data-end, square baseline, air between pairs.
  const barStyle = {
    borderRadius: { topLeft: 4, topRight: 4 },
    borderSkipped: false,
    maxBarThickness: 20,
    categoryPercentage: 0.66,
    barPercentage: 0.82,   // ~2px of surface between the spend/income pair
  };

  const mainData = useMemo(() => ({
    labels: tickLabels,
    datasets: [
      {
        label: 'Spends',
        data: data.map(d => d.spend),
        backgroundColor: hexToRgba(T.spend, 0.9),
        hoverBackgroundColor: T.spend,
        ...barStyle,
      },
      {
        label: 'Income',
        data: data.map(d => d.income),
        backgroundColor: hexToRgba(T.income, 0.9),
        hoverBackgroundColor: T.income,
        ...barStyle,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [data, tickLabels, T]);

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
    // Whole-column hover: anywhere in the bucket lights both bars and the
    // tooltip, so thin bars don't have to be hit precisely.
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      hoverBand: { color: hexToRgba(T.grid, 0.55) },
      tooltip: {
        backgroundColor: T.tooltipBg,
        borderColor: 'rgba(148,163,184,0.2)',
        borderWidth: 1,
        padding: 13,
        cornerRadius: 10,
        titleColor: T.tooltipText,
        bodyColor: hexToRgba(T.tooltipText, 0.75),
        titleFont: { size: 12, weight: '600', family: "'Inter'" },
        bodyFont: { size: 12, family: "'Inter'" },
        callbacks: {
          title: items => fullLabels[items[0]?.dataIndex] ?? '',
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
        ticks: { ...X_TICKS, color: T.axisTick },
        border: { display: false },
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [yScale, handleBarClick, fullLabels, T]);

  // ── Render helpers ─────────────────────────────────────────────────────
  const renderChart = () => {
    // First load: spinner. Refetch: keep the previous bars, dimmed — no flash.
    if (loading && !data.length) {
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

    const cls = [
      'split-chart-container',
      loading    ? 'is-refetching' : '',
      edges.left  ? 'has-more-left'  : '',
      edges.right ? 'has-more-right' : '',
    ].filter(Boolean).join(' ');

    return (
      <div className={cls}>
        <div className="y-axis-panel">
          <Bar key={theme} data={axisData} options={axisOptions} />
        </div>
        <div className="bars-scroll-panel" ref={scrollRef} onScroll={handleScroll}>
          <div style={{ position: 'relative', height: '100%', minWidth: `max(100%, ${data.length * barGroupWidth}px)` }}>
            <Bar key={theme} data={mainData} options={mainOptions} plugins={[hoverBandPlugin]} />
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
          onClick={() => handleTileClick('income')}
          active={drillDown?.kind === 'income'}
          title="Show the income transactions behind this total"
        />
        <StatCard
          label="Total Spends"
          value={currencyFormatter.format(summary.totalSpends)}
          valueColor="#f87171"
          onClick={() => handleTileClick('spend')}
          active={drillDown?.kind === 'spend'}
          title="Show the spend transactions behind this total"
        />
        <StatCard
          label="Net Flow"
          value={`${netPositive ? '+' : ''}${currencyFormatter.format(summary.netFlow)}`}
          valueColor={netPositive ? '#34d399' : '#f87171'}
          sub={netPositive ? 'Positive cash flow' : 'Negative cash flow'}
          accent={netPositive ? '#34d399' : '#f87171'}
          onClick={() => handleTileClick('all')}
          active={drillDown?.kind === 'all'}
          title="Show every transaction in this range"
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
                    // api/statements (bar drill-down) and api/trends/transactions
                    // (tile drill-down) name the date field differently.
                    const date     = t.TransactionDate ?? t.transactionDate ?? t.date;
                    const desc     = t.Description    ?? t.description;
                    const merchant = t.Merchant       ?? t.merchant;
                    const isCredit = credit > 0;
                    const amount   = isCredit ? credit : debit;
                    const name     = maskName(merchant && merchant !== '-' ? merchant : (desc || '—'));
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
                          {desc && desc !== name && !isNameMasked() && (
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