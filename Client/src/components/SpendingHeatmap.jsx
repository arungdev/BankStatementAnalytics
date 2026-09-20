import { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../api/client';
import { currencyFormatter, isAmountMasked, MASKED_AMOUNT } from '../utils/format';
import { FiChevronLeft, FiChevronRight, FiCalendar, FiTrendingUp, FiCheckCircle } from 'react-icons/fi';
import './SpendingHeatmap.css';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Format a local Date object to YYYY-MM-DD safely without timezone shifts
const formatDateKey = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export default function SpendingHeatmap({ accountId, accountIds, onSelectDay }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hoveredCell, setHoveredCell] = useState(null);

  const fetchData = useCallback(() => {
    if (!accountId && !accountIds) return;
    setLoading(true);

    const params = new URLSearchParams({ year: String(year) });
    if (accountIds) params.append('accountIds', accountIds);
    else if (accountId) params.append('accountId', accountId);

    api.get(`/trends/daily-spend?${params.toString()}`)
      .then(res => setData(Array.isArray(res.data) ? res.data : []))
      .catch(err => {
        console.error('Failed to fetch daily spend', err);
        setData([]);
      })
      .finally(() => setLoading(false));
  }, [accountId, accountIds, year]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Map "YYYY-MM-DD" -> { totalDebit, count }
  const spendMap = useMemo(() => {
    const map = new Map();
    data.forEach(item => {
      map.set(item.date, { totalDebit: item.totalDebit, count: item.count });
    });
    return map;
  }, [data]);

  // Calculate max spend for color scaling (90th percentile to avoid outliers crushing the scale)
  const maxSpend = useMemo(() => {
    if (!data.length) return 1000;
    const sorted = [...data].map(d => d.totalDebit).filter(d => d > 0).sort((a, b) => a - b);
    if (!sorted.length) return 1000;
    const p90Index = Math.floor(sorted.length * 0.9);
    return Math.max(sorted[p90Index] || sorted[sorted.length - 1], 500);
  }, [data]);

  // Summary statistics for badges
  const stats = useMemo(() => {
    const total = data.reduce((sum, d) => sum + d.totalDebit, 0);
    const activeDays = data.filter(d => d.totalDebit > 0).length;
    const avgDaily = activeDays > 0 ? total / activeDays : 0;
    
    let maxDaySpend = 0;
    let maxDayDate = null;
    data.forEach(d => {
      if (d.totalDebit > maxDaySpend) {
        maxDaySpend = d.totalDebit;
        maxDayDate = d.date;
      }
    });

    return { total, activeDays, avgDaily, maxDaySpend, maxDayDate };
  }, [data]);

  // Build grid data: 52-53 weeks for the selected year
  const { weeks, monthHeaders } = useMemo(() => {
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31);
    const resultWeeks = [];
    let currentWeek = [];

    // Pad first week with nulls if Jan 1 is not Sunday
    const firstDayOfWeek = start.getDay();
    for (let i = 0; i < firstDayOfWeek; i++) {
      currentWeek.push(null);
    }

    const cur = new Date(start);
    while (cur <= end) {
      const dateStr = formatDateKey(cur);
      const spend = spendMap.get(dateStr);
      currentWeek.push({
        date: dateStr,
        dayOfWeek: cur.getDay(),
        totalDebit: spend?.totalDebit || 0,
        count: spend?.count || 0,
      });

      if (currentWeek.length === 7) {
        resultWeeks.push(currentWeek);
        currentWeek = [];
      }
      cur.setDate(cur.getDate() + 1);
    }

    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) {
        currentWeek.push(null);
      }
      resultWeeks.push(currentWeek);
    }

    // Determine month headers aligned per week column
    const headers = [];
    let lastMonth = -1;

    resultWeeks.forEach((w) => {
      // Find the first valid day in this week
      const validDay = w.find(d => d !== null);
      if (validDay) {
        const monthIndex = parseInt(validDay.date.split('-')[1], 10) - 1;
        if (monthIndex !== lastMonth) {
          headers.push(MONTH_NAMES[monthIndex]);
          lastMonth = monthIndex;
        } else {
          headers.push(null);
        }
      } else {
        headers.push(null);
      }
    });

    return { weeks: resultWeeks, monthHeaders: headers };
  }, [year, spendMap]);

  const getColorTier = (amount) => {
    if (!amount || amount <= 0) return 'tier-0';
    const ratio = amount / maxSpend;
    if (ratio < 0.20) return 'tier-1';
    if (ratio < 0.50) return 'tier-2';
    if (ratio < 0.80) return 'tier-3';
    return 'tier-4';
  };

  return (
    <div className="spending-heatmap-card">
      {/* ── Header ── */}
      <div className="spending-heatmap-header">
        <div className="spending-heatmap-title-group">
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
            <div className="heatmap-icon-box">
              <FiCalendar size={18} />
            </div>
            <div>
              <h3 className="spending-heatmap-title">Daily Spending Heatmap</h3>
              <p className="spending-heatmap-desc">
                Activity distribution across all 365 days for {year}
              </p>
            </div>
          </div>
        </div>

        {/* Year Selector */}
        <div className="spending-heatmap-controls">
          <button
            className="heatmap-nav-btn"
            onClick={() => setYear(y => y - 1)}
            title="Previous Year"
            aria-label="Previous Year"
          >
            <FiChevronLeft size={16} />
          </button>
          <span className="heatmap-year-label">{year}</span>
          <button
            className="heatmap-nav-btn"
            onClick={() => setYear(y => y + 1)}
            disabled={year >= currentYear}
            title="Next Year"
            aria-label="Next Year"
          >
            <FiChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* ── Stat Badges Row ── */}
      <div className="heatmap-stats-strip">
        <div className="heatmap-stat-item">
          <span className="heatmap-stat-label">Total Outflow</span>
          <span className="heatmap-stat-value tnum">
            {isAmountMasked() ? MASKED_AMOUNT : currencyFormatter.format(stats.total)}
          </span>
        </div>
        <div className="heatmap-stat-divider" />
        <div className="heatmap-stat-item">
          <span className="heatmap-stat-label">Active Spend Days</span>
          <span className="heatmap-stat-value">
            {stats.activeDays} <span className="heatmap-stat-sub">/ 365</span>
          </span>
        </div>
        <div className="heatmap-stat-divider" />
        <div className="heatmap-stat-item">
          <span className="heatmap-stat-label">Daily Average</span>
          <span className="heatmap-stat-value tnum">
            {isAmountMasked() ? MASKED_AMOUNT : currencyFormatter.format(stats.avgDaily)}
          </span>
        </div>
        {stats.maxDaySpend > 0 && (
          <>
            <div className="heatmap-stat-divider" />
            <div className="heatmap-stat-item">
              <span className="heatmap-stat-label">Peak Spend Day</span>
              <span className="heatmap-stat-value tnum" style={{ color: 'var(--primary)' }}>
                {isAmountMasked() ? MASKED_AMOUNT : currencyFormatter.format(stats.maxDaySpend)}
              </span>
            </div>
          </>
        )}
      </div>

      {/* ── Main Heatmap Grid ── */}
      <div className="heatmap-scroll-area">
        <div className="heatmap-grid-container">
          {/* Months Track (each cell aligns with the week column) */}
          <div className="heatmap-months-row">
            <div className="heatmap-day-label-spacer" />
            <div className="heatmap-columns-row">
              {monthHeaders.map((m, idx) => (
                <div key={idx} className="heatmap-month-cell">
                  {m && <span className="heatmap-month-text">{m}</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Grid Body */}
          <div className="heatmap-body">
            {/* Day of Week Labels (Mon, Wed, Fri) */}
            <div className="heatmap-days-col">
              {DAY_LABELS.map((label, idx) => (
                <span key={label} className="heatmap-day-label">
                  {idx === 1 ? 'Mon' : idx === 3 ? 'Wed' : idx === 5 ? 'Fri' : ''}
                </span>
              ))}
            </div>

            {/* Week Columns Grid */}
            <div className="heatmap-cells-grid">
              {weeks.map((week, wIdx) => (
                <div key={wIdx} className="heatmap-week-col">
                  {week.map((day, dIdx) => {
                    if (!day) {
                      return <div key={`empty-${dIdx}`} className="heatmap-cell empty" />;
                    }
                    const tier = getColorTier(day.totalDebit);
                    const isSelected = hoveredCell?.date === day.date;

                    return (
                      <div
                        key={day.date}
                        className={`heatmap-cell ${tier} ${isSelected ? 'selected' : ''}`}
                        onClick={() => onSelectDay?.(day.date, day.totalDebit)}
                        onMouseEnter={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setHoveredCell({
                            date: day.date,
                            totalDebit: day.totalDebit,
                            count: day.count,
                            x: rect.left + rect.width / 2,
                            y: rect.top - 8,
                          });
                        }}
                        onMouseLeave={() => setHoveredCell(null)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer / Legend ── */}
      <div className="heatmap-footer">
        <span className="heatmap-hint-text">
          💡 Click any day to inspect its full transaction list
        </span>
        <div className="heatmap-legend">
          <span className="heatmap-legend-label">Less</span>
          <span className="heatmap-cell tier-0 legend-sample" />
          <span className="heatmap-cell tier-1 legend-sample" />
          <span className="heatmap-cell tier-2 legend-sample" />
          <span className="heatmap-cell tier-3 legend-sample" />
          <span className="heatmap-cell tier-4 legend-sample" />
          <span className="heatmap-legend-label">More</span>
        </div>
      </div>

      {/* ── Floating Hover Tooltip ── */}
      {hoveredCell && (
        <div
          className="heatmap-tooltip"
          style={{
            left: `${hoveredCell.x}px`,
            top: `${hoveredCell.y}px`,
          }}
        >
          <div className="heatmap-tooltip-date">
            {new Date(hoveredCell.date).toLocaleDateString('en-IN', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </div>
          <div className="heatmap-tooltip-amount tnum">
            {hoveredCell.totalDebit > 0
              ? (isAmountMasked() ? MASKED_AMOUNT : currencyFormatter.format(hoveredCell.totalDebit))
              : 'No spend'}
          </div>
          {hoveredCell.count > 0 && (
            <div className="heatmap-tooltip-count">
              {hoveredCell.count} {hoveredCell.count === 1 ? 'transaction' : 'transactions'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
