import { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { FiCreditCard } from 'react-icons/fi';
import { getCardSummary, getCardCycles } from '../api/cards';
import useTheme from '../context/useTheme';
import { getToken } from '../theme/chartTheme';
import { currencyFormatter as fmt, formatDate } from '../utils/format';

const fmtK = v => v >= 100000
  ? `₹${(v / 100000).toFixed(1)}L`
  : v >= 1000
  ? `₹${(v / 1000).toFixed(0)}k`
  : `₹${v}`;

const card = {
  background: 'var(--surface)',
  borderRadius: '14px',
  padding: '22px 24px',
  border: '1px solid var(--border-color)',
  boxShadow: 'var(--shadow-sm)',
};

const tileLabel = {
  margin: 0,
  fontSize: '11px',
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.4px',
};

const tileValue = {
  margin: '4px 0 0',
  fontSize: '18px',
  fontWeight: 800,
  color: 'var(--text-main)',
  fontVariantNumeric: 'tabular-nums',
};

// Utilization is a status, not a series: <30% healthy, 30–60% elevated, >60% high.
const utilizationStatus = (pct) => {
  if (pct == null) return null;
  if (pct < 0.3) return { color: 'var(--success)', label: 'Healthy' };
  if (pct < 0.6) return { color: 'var(--warning)', label: 'Elevated' };
  return { color: 'var(--danger)', label: 'High' };
};

const dueBadge = (statement) => {
  if (!statement?.paymentDueDate) return null;
  if (statement.paid) return { text: 'Paid', color: 'var(--success)' };
  const d = statement.daysUntilDue;
  if (d < 0) return { text: `Overdue by ${-d} day${-d === 1 ? '' : 's'}`, color: 'var(--danger)' };
  if (d === 0) return { text: 'Due today', color: 'var(--danger)' };
  if (d <= 5) return { text: `Due in ${d} day${d === 1 ? '' : 's'}`, color: 'var(--warning)' };
  return { text: `Due in ${d} days`, color: 'var(--text-muted)' };
};

/**
 * Credit-card-only panel: the parsed statement summary (dues / due date),
 * credit utilization meter, and spend-per-billing-cycle chart. Rendered by
 * Overview only when the selected account is a credit card.
 */
export default function CreditCardPanel({ accountId, onOpenSettings }) {
  const { theme } = useTheme();
  const [summary, setSummary] = useState(null);
  const [cycles, setCycles] = useState([]);

  const chartC = useMemo(() => ({
    spend: getToken('chart-spend'),
    grid: getToken('chart-grid'),
    tick: getToken('chart-tick'),
    tooltipBg: getToken('surface'),
    tooltipText: getToken('text-main'),
    tooltipBorder: getToken('border-color'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [theme]);

  useEffect(() => {
    if (!accountId) return;
    let stale = false; // ignore responses for a previously selected card
    Promise.all([getCardSummary(accountId), getCardCycles(accountId, 6)])
      .then(([sum, cyc]) => {
        if (stale) return;
        setSummary(sum.data);
        setCycles(Array.isArray(cyc.data) ? cyc.data : []);
      })
      .catch(err => {
        console.error('Failed to fetch card data', err);
        if (!stale) { setSummary(null); setCycles([]); }
      });
    return () => { stale = true; };
  }, [accountId]);

  if (!summary || summary.accountId !== accountId) return null;

  const st = summary.statement;
  const utilization = summary.utilization;
  const status = utilizationStatus(utilization);
  const badge = dueBadge(st);
  const cycle = summary.currentCycle;
  const hasSpendData = cycles.some(c => c.spend > 0);

  return (
    <div style={{ ...card, marginBottom: '20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '16px' }}>
        <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: 'var(--text-main)', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <FiCreditCard size={15} style={{ color: 'var(--primary)' }} />
          Credit Card · {summary.maskedAccountNumber?.slice(-4) ? `•••• ${summary.maskedAccountNumber.slice(-4)}` : ''}
        </p>
        {st?.rewardPointsBalance != null && (
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
            {st.rewardPointsBalance.toLocaleString('en-IN')} reward points
          </span>
        )}
      </div>

      {/* Statement summary tiles */}
      {st ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '14px', marginBottom: '18px' }}>
          <div>
            <p style={tileLabel}>Total due</p>
            <p style={tileValue}>{st.totalDue != null ? fmt.format(st.totalDue) : '—'}</p>
          </div>
          <div>
            <p style={tileLabel}>Minimum due</p>
            <p style={tileValue}>{st.minimumDue != null ? fmt.format(st.minimumDue) : '—'}</p>
          </div>
          <div>
            <p style={tileLabel}>Due date</p>
            <p style={tileValue}>{st.paymentDueDate ? formatDate(st.paymentDueDate) : '—'}</p>
            {badge && (
              <span style={{ fontSize: '11px', fontWeight: 700, color: badge.color }}>{badge.text}</span>
            )}
          </div>
          <div>
            <p style={tileLabel}>Statement period</p>
            <p style={{ ...tileValue, fontSize: '14px' }}>
              {st.periodStart && st.periodEnd
                ? `${formatDate(st.periodStart)} – ${formatDate(st.periodEnd)}`
                : st.statementDate ? formatDate(st.statementDate) : '—'}
            </p>
          </div>
        </div>
      ) : (
        <p style={{ margin: '0 0 18px', fontSize: '12px', color: 'var(--text-muted)' }}>
          Upload a credit card PDF statement to see total due, minimum due, and the payment due date here.
        </p>
      )}

      {/* Utilization meter */}
      <div style={{ marginBottom: '18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
          <p style={tileLabel}>Credit utilization</p>
          {status && (
            <span style={{ fontSize: '12px', fontWeight: 700, color: status.color }}>
              {(utilization * 100).toFixed(1)}% · {status.label}
            </span>
          )}
        </div>
        {summary.creditLimit > 0 ? (
          <>
            <div style={{ height: '8px', background: 'var(--border-subtle)', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{
                width: `${Math.min(100, Math.max(utilization * 100, 1))}%`,
                height: '100%',
                background: status.color,
                borderRadius: '4px',
                transition: 'width 0.5s ease',
              }} />
            </div>
            <p style={{ margin: '5px 0 0', fontSize: '11px', color: 'var(--text-muted)' }}>
              {fmt.format(summary.outstanding)} outstanding of {fmt.format(summary.creditLimit)} limit
            </p>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
            No credit limit known yet — upload a PDF statement, or{' '}
            <button
              onClick={onOpenSettings}
              style={{ background: 'none', border: 'none', padding: 0, color: 'var(--primary)', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}
            >
              set it in Settings
            </button>.
          </p>
        )}
      </div>

      {/* Billing-cycle spend */}
      {hasSpendData && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
            <p style={tileLabel}>Spend by billing cycle</p>
            {cycle && (
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
                {fmt.format(cycle.spendSoFar)} so far · {cycle.daysLeft} day{cycle.daysLeft === 1 ? '' : 's'} left in cycle
              </span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={cycles} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartC.grid} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: chartC.tick }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={fmtK} tick={{ fontSize: 11, fill: chartC.tick }} axisLine={false} tickLine={false} width={54} />
              <Tooltip
                formatter={(v) => [fmt.format(v), 'Spend']}
                labelFormatter={(label, payload) => {
                  const c = payload?.[0]?.payload;
                  if (!c) return label;
                  return `${formatDate(c.start)} – ${formatDate(c.end)}${c.isCurrent ? ' (current)' : ''}`;
                }}
                cursor={{ fill: chartC.grid, opacity: 0.35 }}
                contentStyle={{ borderRadius: '10px', border: `1px solid ${chartC.tooltipBorder}`, background: chartC.tooltipBg, color: chartC.tooltipText, boxShadow: 'var(--shadow-lg)', fontSize: '12px' }}
                labelStyle={{ color: chartC.tooltipText }}
                itemStyle={{ color: chartC.tooltipText }}
              />
              <Bar dataKey="spend" radius={[4, 4, 0, 0]} maxBarSize={44}>
                {cycles.map((c, i) => (
                  // Same hue for every cycle (one series); the in-progress cycle is
                  // dimmed — it's an incomplete figure, not a different entity.
                  <Cell key={i} fill={chartC.spend} fillOpacity={c.isCurrent ? 0.45 : 0.9} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
