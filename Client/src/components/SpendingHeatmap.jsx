import { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../api/client';
import { currencyFormatter, isAmountMasked, MASKED_AMOUNT } from '../utils/format';
import { FiChevronLeft, FiChevronRight, FiCalendar } from 'react-icons/fi';
import './SpendingHeatmap.css';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function SpendingHeatmap({ accountId, accountIds, onSelectDay }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hoveredCell, setHoveredCell] = useState(null);

  const fetchData = useCallback(() => {
    if (!accountId && !accountIds) return;
    setLoading(true);

    const params = new URLSearchParams({ year });
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

  // Year stats
  const stats = useMemo(() => {
    const total = data.reduce((sum, d) => sum + d.totalDebit, 0);
    const activeDays = data.filter(d => d.totalDebit > 0).length;
    const avgDaily = activeDays > 0 ? total / activeDays : 0;
    return { total, activeDays, avgDaily };
  }, [data]);

  // Build grid data: weeks array for the selected year
  const grid = useMemo(() => {
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31);
    const weeks = [];
    let currentWeek = [];

    // Pad first week if Jan 1 is not Sunday (day 0)
    const firstDayOfWeek = start.getDay();
    for (let i = 0; i < firstDayOfWeek; i++) {
      currentWeek.push(null);
    }

    const cur = new Date(start);
    while (cur <= end) {
      const dateStr = cur.toISOString().split('T')[0];
      const spend = spendMap.get(dateStr);
      currentWeek.push({
        date: dateStr,
        dayOfWeek: cur.getDay(),
        totalDebit: spend?.totalDebit || 0,
        count: spend?.count || 0,
      });

      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
      cur.setDate(cur.getDate() + 1);
    }

    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) {
        currentWeek.push(null);
      }
      weeks.push(currentWeek);
    }

    return weeks;
  }, [year, spendMap]);

  // Determine month label positions along columns
  const monthLabels = useMemo(() => {
    const labels = [];
    let lastMonth = -1;

    grid.forEach((week, weekIdx) => {
      // Find the first non-null day in this week
      const firstDay = week.find(d => d !== null);
      if (firstDay) {
        const month = parseInt(firstDay.date.split('-')[1], 10) - 1;
        if (month !== lastMonth) {
          labels.push({ month: MONTH_NAMES[month], weekIdx });
          lastMonth = month;
        }
      }
    });

    return labels;
  }, [grid]);

  const getColorTier = (amount) => {
    if (!amount || amount <= 0) return 'tier-0';
    const ratio = amount / maxSpend;
    if (ratio < 0.2) return 'tier-1';
    if (ratio < 0.45) return 'tier-2';
    if (ratio < 0.75) return 'tier-3';
    return 'tier-4';
  };

  return (
    <div className="spending-heatmap-card">
      <div className="spending-heatmap-header">
        <div className="spending-heatmap-title-group">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FiCalendar style={{ color: 'var(--primary)' }} size={16} />
            <h3 className="spending-heatmap-title">Daily Spending Heatmap</h3>
          </div>
          <span className="spending-heatmap-subtitle">
            {stats.activeDays} spend days • Total {isAmountMasked() ? MASKED_AMOUNT : currencyFormatter.format(stats.total)}
          </span>
        </div>

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

      <div className="heatmap-scroll-area">
        <div className="heatmap-grid-container">
          {/* Month Labels Row */}
          <div className="heatmap-months-row">
            <div className="heatmap-day-label-spacer" />
            <div className="heatmap-months-track">
              {monthLabels.map(({ month, weekIdx }) => (
                <span
                  key={`${month}-${weekIdx}`}
                  className="heatmap-month-label"
                  style={{ left: `${weekIdx * 14}px` }}
                >
                  {month}
                </span>
              ))}
            </div>
          </div>

          {/* Grid Rows (Days 0-6: Sun-Sat) */}
          <div className="heatmap-body">
            <div className="heatmap-days-col">
              {DAY_LABELS.map((label, idx) => (
                <span key={label} className="heatmap-day-label">
                  {idx % 2 === 1 ? label : ''}
                </span>
              ))}
            </div>

            <div className="heatmap-cells-grid">
              {grid.map((week, wIdx) => (
                <div key={wIdx} className="heatmap-week-col">
                  {week.map((day, dIdx) => {
                    if (!day) {
                      return <div key={`empty-${dIdx}`} className="heatmap-cell empty" />;
                    }
                    const tier = getColorTier(day.totalDebit);
                    return (
                      <div
                        key={day.date}
                        className={`heatmap-cell ${tier}`}
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

      {/* Footer Legend */}
      <div className="heatmap-footer">
        <div className="heatmap-legend">
          <span className="heatmap-legend-label">Less</span>
          <div className="heatmap-cell tier-0" />
          <div className="heatmap-cell tier-1" />
          <div className="heatmap-cell tier-2" />
          <div className="heatmap-cell tier-3" />
          <div className="heatmap-cell tier-4" />
          <span className="heatmap-legend-label">More</span>
        </div>
      </div>

      {/* Floating Tooltip */}
      {hoveredCell && (
        <div
          className="heatmap-tooltip"
          style={{ left: `${hoveredCell.x}px`, top: `${hoveredCell.y}px` }}
        >
          <div className="heatmap-tooltip-date">
            {new Date(hoveredCell.date).toLocaleDateString('en-IN', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </div>
          <div className="heatmap-tooltip-amount">
            {hoveredCell.totalDebit > 0
              ? (isAmountMasked() ? MASKED_AMOUNT : currencyFormatter.format(hoveredCell.totalDebit))
              : 'No spend'}
          </div>
          {hoveredCell.count > 0 && (
            <div className="heatmap-tooltip-count">
              {hoveredCell.count} transaction{hoveredCell.count > 1 ? 's' : ''} • Click to view
            </div>
          )}
        </div>
      )}
    </div>
  );
}
