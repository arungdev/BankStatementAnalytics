import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAccount } from '../context/useAccount';
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
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import './Trends.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

// ── Chart colour tokens (light theme) ────────────────────────────────────
const C = {
  green:      '#16a34a',
  greenFill:  'rgba(22,163,74,0.72)',
  red:        '#dc2626',
  redFill:    'rgba(220,38,38,0.70)',
  grid:       '#f0f2f4',
  tickColor:  '#9ca3af',
  tooltipBg:  '#1e293b',
};

const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', minimumFractionDigits: 0,
});

const formatShort = (v) => {
  if (v >= 10000000) return (v / 10000000).toFixed(1) + 'Cr';
  if (v >= 100000)   return (v / 100000).toFixed(2)   + 'L';
  if (v >= 1000)     return (v / 1000).toFixed(1)     + 'k';
  return v;
};

const VISIBLE_GROUPS = 8;

const Trends = () => {
  const [period, setPeriod]       = useState('week');
  const [dateRange, setDateRange] = useState([null, null]);
  const [startDate, endDate]      = dateRange;
  const [data, setData]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const { selectedAccountId }     = useAccount();

  const [visibleRange, setVisibleRange] = useState({ start: 0, end: Infinity });
  const scrollRef   = useRef(null);
  const debounceRef = useRef(null);
  const barGroupWidth = period === 'day' ? 150 : 60;

  // ── Fetch ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedAccountId) { setLoading(false); setData([]); return; }
    setLoading(true);
    const toLocalDate = (d) =>
      `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

    const params = new URLSearchParams({ accountId: selectedAccountId, period });
    if (startDate) params.append('startDate', toLocalDate(startDate));
    if (endDate)   params.append('endDate',   toLocalDate(endDate));
    api.get(`/trends?${params.toString()}`)
      .then(res => {
        let rows = Array.isArray(res.data) ? res.data : [];

        // Client-side safety net: drop rows outside the selected range.
        // The API response now always includes an ISO `date` field.
        if (startDate || endDate) {
          const fromStr = startDate
            ? `${startDate.getFullYear()}-${String(startDate.getMonth()+1).padStart(2,'0')}-${String(startDate.getDate()).padStart(2,'0')}`
            : null;
          const toStr = endDate
            ? `${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2,'0')}-${String(endDate.getDate()).padStart(2,'0')}`
            : null;

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
  }, [period, selectedAccountId, startDate, endDate]);

  useEffect(() => {
    setVisibleRange({ start: 0, end: Math.min(VISIBLE_GROUPS, data.length) });
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  }, [data]);

  // ── Scroll → visible range ────────────────────────────────────────────────
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

  // ── Dynamic Y-max ─────────────────────────────────────────────────────────
  const visibleYMax = useMemo(() => {
    if (!data.length) return 100;
    const slice = data.slice(visibleRange.start, visibleRange.end);
    const max   = slice.reduce((m, d) => Math.max(m, d.income, d.spend), 0);
    return max > 0 ? max * 1.18 : 100;
  }, [data, visibleRange]);

  // ── Summary ───────────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    if (!data.length) return { totalIncome: 0, totalSpends: 0, netFlow: 0 };
    const totalIncome = data.reduce((s, d) => s + d.income, 0);
    const totalSpends = data.reduce((s, d) => s + d.spend,  0);
    return { totalIncome, totalSpends, netFlow: totalIncome - totalSpends };
  }, [data]);

  // ── Shared Y scale factory ────────────────────────────────────────────────
  const makeYScale = (showTicks) => ({
    beginAtZero: true,
    max: visibleYMax,
    grid: { color: C.grid, borderDash: [3, 5], drawTicks: false },
    ticks: showTicks
      ? { callback: formatShort, maxTicksLimit: 5, font: { size: 10.5, family: "'DM Sans'" }, color: C.tickColor, padding: 6 }
      : { display: false },
    border: { display: false },
  });

  // ── Left Y-axis-only chart ────────────────────────────────────────────────
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

  // ── Main bars chart ───────────────────────────────────────────────────────
  const mainData = useMemo(() => ({
    labels: data.map(d => d.label),
    datasets: [
      {
        label: 'Spends',
        data: data.map(d => d.spend),
        backgroundColor: C.redFill,
        hoverBackgroundColor: C.red,
        borderColor: C.red,
        borderWidth: { top: 3, left: 0, right: 0, bottom: 0 },
        borderRadius: { topLeft: 5, topRight: 5 },
        borderSkipped: false,
      },
      {
        label: 'Income',
        data: data.map(d => d.income),
        backgroundColor: C.greenFill,
        hoverBackgroundColor: C.green,
        borderColor: C.green,
        borderWidth: { top: 3, left: 0, right: 0, bottom: 0 },
        borderRadius: { topLeft: 5, topRight: 5 },
        borderSkipped: false,
      },
    ],
  }), [data]);

  const mainOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 350, easing: 'easeOutQuart' },
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
        titleFont: { size: 12, weight: '600', family: "'DM Sans'" },
        bodyFont:  { size: 12, family: "'DM Sans'" },
        callbacks: {
          label: ctx => `  ${ctx.dataset.label}  ${currencyFormatter.format(ctx.parsed.y)}`,
          afterBody: (items) => {
            if (items.length < 2) return [];
            const spend  = items.find(i => i.dataset.label === 'Spends')?.parsed.y ?? 0;
            const income = items.find(i => i.dataset.label === 'Income')?.parsed.y ?? 0;
            const net    = income - spend;
            return [`  Net  ${net >= 0 ? '+' : ''}${currencyFormatter.format(net)}`];
          },
        },
      },
    },
    scales: {
      y: makeYScale(false),
      x: {
        grid: { display: false },
        ticks: { font: { size: 10.5, family: "'DM Sans'" }, color: C.tickColor, maxRotation: 0 },
        border: { display: false },
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [visibleYMax]);

  // ── Render helpers ────────────────────────────────────────────────────────
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
          <svg width="44" height="44" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18h18M7 16l4-4 4 4 4-4" />
          </svg>
          <p>No data for this period</p>
          <span>Select an account or adjust the date range.</span>
        </div>
      );
    }

    return (
      <div className="split-chart-container">
        <div className="y-axis-panel">
          <Bar data={axisData} options={axisOptions} />
        </div>
        <div className="bars-scroll-panel" ref={scrollRef} onScroll={handleScroll}>
          <div style={{ position: 'relative', height: '100%', minWidth: `${data.length * barGroupWidth}px` }}>
            <Bar data={mainData} options={mainOptions} />
          </div>
        </div>
      </div>
    );
  };

  const netPositive = summary.netFlow >= 0;

  return (
    <div className="trends-container">

      {/* Header — z-index: 100 in CSS so picker floats above everything */}
      <div className="trends-header">
        <div className="date-range-picker">
          <DatePicker
            selectsRange
            startDate={startDate}
            endDate={endDate}
            onChange={setDateRange}
            isClearable
            placeholderText="Filter by date range"
            popperPlacement="bottom-start"
            popperModifiers={[
              { name: 'offset', options: { offset: [0, 4] } },
              { name: 'preventOverflow', options: { boundary: 'viewport' } },
            ]}
          />
        </div>
        <div className="filter-group">
          {['day', 'week', 'month'].map(p => (
            <button key={p} onClick={() => setPeriod(p)} className={period === p ? 'active' : ''}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="summary-stats">
        <div className="summary-card">
          <span className="summary-title">Total Income</span>
          <span className="summary-value income">{currencyFormatter.format(summary.totalIncome)}</span>
        </div>
        <div className="summary-card">
          <span className="summary-title">Total Spends</span>
          <span className="summary-value spend">{currencyFormatter.format(summary.totalSpends)}</span>
        </div>
        <div className={`summary-card ${netPositive ? 'net-positive' : 'net-negative'}`}>
          <span className="summary-title">Net Flow</span>
          <span className={`summary-value ${netPositive ? 'income' : 'spend'}`}>
            {netPositive ? '+' : ''}{currencyFormatter.format(summary.netFlow)}
          </span>
        </div>
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

    </div>
  );
};

export default Trends;