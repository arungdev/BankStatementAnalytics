import React from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import StatCard from './StatCard';
import { currencyFormatter as fmt, maskName } from '../utils/format';
import { FiTrendingUp, FiTrendingDown, FiPieChart, FiAward } from 'react-icons/fi';

const fmtK = (v) => {
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(0)}k`;
  return `₹${v}`;
};

export default function AnnualSummaryView({ data, palette, chartC }) {
  if (!data) return null;

  const {
    year,
    totalIncome = 0,
    totalSpend = 0,
    netSavings = 0,
    savingsRate = 0,
    highestSpendMonthAmount = 0,
    highestSpendMonthName = '—',
    lowestSpendMonthAmount = 0,
    lowestSpendMonthName = '—',
    avgMonthlySpend = 0,
    monthly = [],
    topCategories = [],
    topMerchants = [],
  } = data;

  const netPositive = netSavings >= 0;

  return (
    <div className="annual-summary-view" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* ── Highlight Banner ── */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(168, 85, 247, 0.08))',
        border: '1px solid rgba(99, 102, 241, 0.25)',
        borderRadius: '16px',
        padding: '24px 28px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '16px',
      }}>
        <div>
          <span style={{
            fontSize: '11px',
            textTransform: 'uppercase',
            fontWeight: 800,
            letterSpacing: '0.08em',
            color: 'var(--primary)',
            background: 'var(--primary-light)',
            padding: '4px 10px',
            borderRadius: '20px',
          }}>
            Year-in-Review {year}
          </span>
          <h2 style={{ margin: '8px 0 4px', fontSize: '24px', fontWeight: 800, color: 'var(--text-main)' }}>
            Annual Financial Recap
          </h2>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
            Comprehensive breakdown of earnings, cash flow, seasonal peaks, and top destinations for {year}.
          </p>
        </div>
        <div style={{
          display: 'flex',
          gap: '16px',
          alignItems: 'center',
          background: 'var(--surface)',
          padding: '12px 20px',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
        }}>
          <div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>Annual Savings Rate</span>
            <div style={{
              fontSize: '22px',
              fontWeight: 800,
              color: savingsRate >= 20 ? 'var(--success)' : savingsRate > 0 ? 'var(--primary)' : 'var(--danger)',
            }}>
              {savingsRate.toFixed(1)}%
            </div>
          </div>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '50%',
            background: 'var(--primary-light)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--primary)',
            fontSize: '18px',
          }}>
            <FiAward />
          </div>
        </div>
      </div>

      {/* ── 4 Top Stat Cards ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '16px',
      }}>
        <StatCard
          label="Total Income"
          value={fmt.format(totalIncome)}
          valueColor="#34d399"
          sub="Total inflows across period"
        />
        <StatCard
          label="Total Spend"
          value={fmt.format(totalSpend)}
          valueColor="#f87171"
          sub="Total outflows excluding transfers"
        />
        <StatCard
          label="Net Savings"
          value={`${netPositive ? '+' : '−'}${fmt.format(Math.abs(netSavings))}`}
          valueColor={netPositive ? '#34d399' : '#f87171'}
          sub={`${savingsRate.toFixed(1)}% of income retained`}
        />
        <StatCard
          label="Monthly Spend Average"
          value={fmt.format(avgMonthlySpend)}
          sub="Average monthly run-rate"
        />
      </div>

      {/* ── Peak & Valley Callout Cards ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '16px',
      }}>
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border-color)',
          borderRadius: '14px',
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
        }}>
          <div style={{
            width: '44px',
            height: '44px',
            borderRadius: '10px',
            background: 'rgba(239, 68, 68, 0.1)',
            color: 'var(--danger)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '20px',
            flexShrink: 0,
          }}>
            <FiTrendingUp />
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Highest Spending Month
            </div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-main)', marginTop: '2px' }}>
              {highestSpendMonthName} — {fmt.format(highestSpendMonthAmount)}
            </div>
          </div>
        </div>

        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border-color)',
          borderRadius: '14px',
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
        }}>
          <div style={{
            width: '44px',
            height: '44px',
            borderRadius: '10px',
            background: 'rgba(16, 185, 129, 0.1)',
            color: 'var(--success)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '20px',
            flexShrink: 0,
          }}>
            <FiTrendingDown />
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Lowest Spending Month
            </div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-main)', marginTop: '2px' }}>
              {lowestSpendMonthName} — {fmt.format(lowestSpendMonthAmount)}
            </div>
          </div>
        </div>
      </div>

      {/* ── Monthly Trajectory Chart ── */}
      <div style={{
        background: 'var(--surface)',
        borderRadius: '14px',
        padding: '22px 24px',
        border: '1px solid var(--border-color)',
      }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700, color: 'var(--text-main)' }}>
          Monthly Cash Flow Trajectory ({year})
        </h3>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={monthly} margin={{ left: 8, right: 8, top: 4, bottom: 0 }} barGap={3}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartC.grid} />
            <XAxis dataKey="monthName" tick={{ fontSize: 11, fill: chartC.tick }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={fmtK} tick={{ fontSize: 11, fill: chartC.tick }} axisLine={false} tickLine={false} />
            <Tooltip
              formatter={(v, name) => [fmt.format(v), { income: 'Income', spend: 'Spend', net: 'Net' }[name] ?? name]}
              contentStyle={{
                borderRadius: '10px',
                border: `1px solid ${chartC.tooltipBorder}`,
                background: chartC.tooltipBg,
                color: chartC.tooltipText,
                boxShadow: 'var(--shadow-lg)',
                fontSize: '12px',
              }}
              cursor={{ fill: chartC.cursor }}
            />
            <Legend formatter={v => <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{{ income: 'Income', spend: 'Spend', net: 'Net' }[v] ?? v}</span>} />
            <Bar dataKey="income" fill={chartC.income} radius={[4, 4, 0, 0]} maxBarSize={22} />
            <Bar dataKey="spend" fill={chartC.spend} radius={[4, 4, 0, 0]} maxBarSize={22} />
            <Line type="monotone" dataKey="net" stroke={chartC.net} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* ── Top Categories & Top Merchants Side-by-Side ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '20px',
      }}>
        {/* Top Categories */}
        <div style={{
          background: 'var(--surface)',
          borderRadius: '14px',
          padding: '22px 24px',
          border: '1px solid var(--border-color)',
        }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FiPieChart /> Top Spending Categories
          </h3>
          {topCategories.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No category data available.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {topCategories.map((c, i) => (
                <div key={c.category}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                      <span style={{
                        display: 'inline-block',
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: palette[i % palette.length],
                        marginRight: '8px',
                      }} />
                      {c.category}
                    </span>
                    <span className="tnum" style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                      {fmt.format(c.totalSpend)} <span style={{ color: 'var(--text-muted)', fontSize: '11px', fontWeight: 500 }}>({c.percentage}%)</span>
                    </span>
                  </div>
                  <div style={{ height: '6px', background: 'var(--border-subtle)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{
                      width: `${Math.min(Math.max(c.percentage, 2), 100)}%`,
                      height: '100%',
                      background: palette[i % palette.length],
                      borderRadius: '4px',
                    }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top Merchants */}
        <div style={{
          background: 'var(--surface)',
          borderRadius: '14px',
          padding: '22px 24px',
          border: '1px solid var(--border-color)',
        }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FiAward /> Top Merchants
          </h3>
          {topMerchants.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No merchant data available.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {topMerchants.map((m, i) => (
                <div key={m.merchant} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  background: 'var(--surface-2)',
                  borderRadius: '10px',
                  border: '1px solid var(--border-subtle)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '6px',
                      background: i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : i === 2 ? '#b45309' : 'var(--border-color)',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '11px',
                      fontWeight: 700,
                    }}>
                      {i + 1}
                    </span>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)' }}>
                        {maskName(m.merchant)}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {m.transactionCount} transactions · {m.percentage}% of spend
                      </div>
                    </div>
                  </div>
                  <div className="tnum" style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-main)' }}>
                    {fmt.format(m.totalSpend)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
