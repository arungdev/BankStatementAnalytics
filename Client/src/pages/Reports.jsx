import { useState, useEffect, useCallback, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useAccount } from '../context/useAccount';
import { ALL_ACCOUNTS } from '../components/AccountFilter';
import api from '../api/client';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { FilterGroup, FilterPill, FilterSelectChip } from '../components/PageHeader';
import StatCard from '../components/StatCard';
import EmptyState from '../components/ui/EmptyState';
import { FiDownload } from 'react-icons/fi';
import useTheme from '../context/useTheme';
import { getToken } from '../theme/chartTheme';
import { currencyFormatter as fmt } from '../utils/format';
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

  const options = reportType === 'year'
    ? (periods.years || []).map(y => ({ value: String(y), label: String(y) }))
    : (periods.months || []).map(m => ({ value: `${m.year}-${m.month}`, label: m.label }));

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

      <FilterGroup>
        <FilterSelectChip
          prefix="Period"
          value={reportPeriod}
          onChange={e => setReportPeriod(e.target.value)}
        >
          {options.length === 0 && <option value="">No data</option>}
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </FilterSelectChip>
      </FilterGroup>
    </>
  );
}

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
    cursor: getToken('primary-light'),
    tooltipBg: getToken('surface'),
    tooltipText: getToken('text-main'),
    tooltipBorder: getToken('border-color'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [theme]);

  const [report, setReport]   = useState(null);
  const [loading, setLoading] = useState(false);

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

  const fetchReport = useCallback(() => {
    if (!accountIdsParam || !period) return;
    const p = new URLSearchParams();
    p.append('type', type);
    p.append('accountIds', accountIdsParam);
    if (type === 'year') {
      p.append('year', period);
    } else {
      const [y, m] = period.split('-');
      if (!y || !m) return;
      p.append('year', y);
      p.append('month', m);
    }
    setLoading(true);
    api.get(`/reports?${p.toString()}`)
      .then(res => setReport(res.data))
      .catch(err => console.error('Failed to fetch report', err))
      .finally(() => setLoading(false));
  }, [accountIdsParam, type, period]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  const summary    = report?.summary;
  const categories = report?.byCategory ?? [];
  const merchants  = report?.topMerchants ?? [];
  const budgets    = report?.budgets ?? [];
  const bills      = report?.bills ?? [];
  const deposits   = report?.deposits;
  const spendTotal = summary?.totalSpends ?? 0;
  const netPositive = (summary?.net ?? 0) >= 0;
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
    statsRow: { display: 'flex', gap: '16px', marginBottom: '20px' },
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

  const downloadPdf = () => window.print();

  return (
    <div className="report-page" style={s.page}>

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
          disabled={!report || loading}
          style={{ display: 'flex', alignItems: 'center', gap: '7px' }}
          title="Opens the print dialog — choose 'Save as PDF'"
        >
          <FiDownload size={15} /> Download PDF
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
              <StatCard label="Total Income" value={fmt.format(summary.totalIncome)} valueColor="#34d399" />
              <StatCard label="Total Spends" value={fmt.format(summary.totalSpends)} valueColor="#f87171" />
              <StatCard
                label="Net Flow"
                value={`${netPositive ? '+' : '−'}${fmt.format(Math.abs(summary.net))}`}
                valueColor={netPositive ? '#34d399' : '#f87171'}
                sub={netPositive ? 'Saved this period' : 'Spent more than earned'}
                accent={netPositive ? T.greenSoft : T.redSoft}
              />
              <StatCard label="Transactions" value={summary.transactionCount.toLocaleString('en-IN')} />
            </div>

            {/* ── Month-by-month chart (yearly only) ── */}
            {type === 'year' && report.monthlySeries && (
              <div className="report-card" style={s.card}>
                <p style={s.cardTitle}>Income vs Spends by Month</p>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={report.monthlySeries} margin={{ left: 8, right: 8, top: 4, bottom: 0 }} barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartC.grid} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: chartC.tick }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={fmtK} tick={{ fontSize: 11, fill: chartC.tick }} axisLine={false} tickLine={false} />
                    <Tooltip
                      formatter={(v, name) => [fmt.format(v), name === 'income' ? 'Income' : 'Spend']}
                      contentStyle={{ borderRadius: '10px', border: `1px solid ${chartC.tooltipBorder}`, background: chartC.tooltipBg, color: chartC.tooltipText, boxShadow: 'var(--shadow-lg)', fontSize: '12px' }}
                      labelStyle={{ color: chartC.tooltipText }}
                      itemStyle={{ color: chartC.tooltipText }}
                      cursor={{ fill: chartC.cursor }}
                    />
                    <Legend
                      formatter={v => <span style={{ fontSize: 12, color: T.muted }}>{v === 'income' ? 'Income' : 'Spend'}</span>}
                    />
                    <Bar dataKey="income" fill={chartC.income} radius={[4, 4, 0, 0]} maxBarSize={20} />
                    <Bar dataKey="spend" fill={chartC.spend} radius={[4, 4, 0, 0]} maxBarSize={20} />
                  </BarChart>
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
                <p style={s.cardTitle}>Top Merchants</p>
                {merchants.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '13px', color: T.muted }}>No merchant spending in this period.</p>
                ) : (
                  merchants.map((m, i) => (
                    <div key={m.name} style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '9px 0', borderBottom: `1px solid ${T.borderSub}`,
                    }}>
                      <span style={{ width: '18px', fontSize: '12px', fontWeight: 700, color: T.faint }}>{i + 1}</span>
                      <span style={{
                        flex: 1, fontSize: '13px', fontWeight: 600, color: T.text,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {m.name}
                      </span>
                      <span style={{ fontSize: '11px', color: T.muted }}>{m.count}×</span>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: T.text }}>{fmt.format(m.total)}</span>
                    </div>
                  ))
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
                <p style={s.cardTitle}>
                  Deposits & Investments
                  <span style={{ fontWeight: 500, color: T.muted, marginLeft: '6px' }}>(all accounts)</span>
                </p>
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
  );
}
