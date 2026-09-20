import { useState, useEffect, useCallback, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { FiTrendingUp, FiAlertTriangle, FiCheckCircle } from 'react-icons/fi';
import api from '../api/client';
import { currencyFormatter as fmt, isAmountMasked, MASKED_AMOUNT } from '../utils/format';

export default function CashFlowForecast({ accountId, accountIds }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(60);

  const fetchForecast = useCallback(() => {
    if (!accountId && !accountIds) return;
    setLoading(true);

    const params = new URLSearchParams({ days });
    if (accountIds) params.append('accountIds', accountIds);
    else if (accountId) params.append('accountId', accountId);

    api.get(`/forecast?${params.toString()}`)
      .then(res => setData(res.data))
      .catch(err => {
        console.error('Failed to load forecast', err);
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [accountId, accountIds, days]);

  useEffect(() => {
    fetchForecast();
  }, [fetchForecast]);

  const chartData = useMemo(() => {
    if (!data?.projections) return [];
    return data.projections.map(p => ({
      ...p,
      displayDate: new Date(p.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    }));
  }, [data]);

  const hasDeficit = data?.lowestProjectedBalance < 0;

  return (
    <div style={{
      background: 'var(--surface)',
      borderRadius: '14px',
      padding: '22px 24px',
      border: '1px solid var(--border-color)',
      boxShadow: 'var(--shadow-sm)',
      marginTop: '20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FiTrendingUp style={{ color: 'var(--primary)' }} size={16} />
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text-main)' }}>
              Cash Flow Forecast
            </h3>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
            Projected account balance accounting for upcoming bills, recurring income, and average daily spend.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {[30, 60, 90].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                border: '1px solid var(--border-color)',
                background: days === d ? 'var(--primary)' : 'var(--surface-2)',
                color: days === d ? '#fff' : 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              {d} Days
            </button>
          ))}
        </div>
      </div>

      {/* Alerts */}
      {data?.alerts && data.alerts.length > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 14px',
          borderRadius: '8px',
          background: hasDeficit ? 'rgba(239, 68, 68, 0.1)' : 'rgba(245, 158, 11, 0.1)',
          border: `1px solid ${hasDeficit ? 'var(--danger)' : 'var(--warning)'}`,
          marginBottom: '16px',
          fontSize: '12px',
          fontWeight: 600,
          color: hasDeficit ? 'var(--danger)' : 'var(--warning)',
        }}>
          <FiAlertTriangle size={15} flexShrink={0} />
          <span>{data.alerts[0]}</span>
        </div>
      )}

      {/* Summary metric tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '18px' }}>
        <div style={{ background: 'var(--surface-2)', padding: '12px 14px', borderRadius: '10px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>Current Starting Balance</div>
          <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-main)', marginTop: '2px' }}>
            {isAmountMasked() ? MASKED_AMOUNT : fmt.format(data?.startingBalance ?? 0)}
          </div>
        </div>

        <div style={{ background: 'var(--surface-2)', padding: '12px 14px', borderRadius: '10px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>Lowest Projected Balance</div>
          <div style={{
            fontSize: '16px',
            fontWeight: 800,
            color: hasDeficit ? 'var(--danger)' : 'var(--text-main)',
            marginTop: '2px',
          }}>
            {isAmountMasked() ? MASKED_AMOUNT : fmt.format(data?.lowestProjectedBalance ?? 0)}
          </div>
          {data?.lowestBalanceDate && (
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
              on {new Date(data.lowestBalanceDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </div>
          )}
        </div>

        <div style={{ background: 'var(--surface-2)', padding: '12px 14px', borderRadius: '10px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>Est. Daily Spending</div>
          <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-main)', marginTop: '2px' }}>
            {isAmountMasked() ? MASKED_AMOUNT : fmt.format(data?.estimatedDailySpend ?? 0)}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>Discretionary baseline</div>
        </div>
      </div>

      {/* Chart */}
      {loading ? (
        <div style={{ height: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
          Computing projections…
        </div>
      ) : chartData.length === 0 ? (
        <div style={{ height: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
          No forecast data available.
        </div>
      ) : (
        <div style={{ height: '220px', width: '100%' }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={hasDeficit ? '#ef4444' : 'var(--primary)'} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={hasDeficit ? '#ef4444' : 'var(--primary)'} stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="displayDate"
                tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                axisLine={{ stroke: 'var(--border-color)' }}
                tickLine={false}
                minTickGap={30}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={v => isAmountMasked() ? '••' : (v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const item = payload[0].payload;
                  return (
                    <div style={{
                      background: '#1e1b4b',
                      color: '#fff',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      boxShadow: 'var(--shadow-lg)',
                      fontSize: '12px',
                    }}>
                      <div style={{ fontWeight: 700, color: '#a5b4fc' }}>
                        {new Date(item.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                      </div>
                      <div style={{ fontSize: '14px', fontWeight: 800, color: '#fff', marginTop: '4px' }}>
                        Balance: {isAmountMasked() ? MASKED_AMOUNT : fmt.format(item.balance)}
                      </div>
                      {item.events && item.events.length > 0 && (
                        <div style={{ marginTop: '6px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '6px' }}>
                          {item.events.map((ev, i) => (
                            <div key={i} style={{ color: ev.includes('+') ? '#34d399' : '#f87171', fontSize: '11px' }}>
                              {ev}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }}
              />
              {hasDeficit && <ReferenceLine y={0} stroke="var(--danger)" strokeDasharray="3 3" />}
              <Area
                type="monotone"
                dataKey="balance"
                stroke={hasDeficit ? 'var(--danger)' : 'var(--primary)'}
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#forecastGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
