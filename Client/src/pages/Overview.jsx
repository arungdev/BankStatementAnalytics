import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useAccount } from '../context/useAccount';
import { ALL_ACCOUNTS } from '../components/AccountFilter';
import api from '../api/client';
import StatCard from '../components/StatCard';
import EmptyState from '../components/ui/EmptyState';
import { currencyFormatter as fmt, formatDate } from '../utils/format';

/* ─── Design tokens — mapped to the global CSS variable system ───────────── */
const T = {
  indigo:     'var(--primary)',
  indigoDim:  'var(--primary-light)',
  indigoSoft: 'var(--stat-tile-label)',
  surface:    'var(--surface)',
  bg:         'var(--bg)',
  border:     'var(--border-color)',
  borderSub:  'var(--border-subtle)',
  text:       'var(--text-main)',
  muted:      'var(--text-muted)',
  faint:      'var(--text-faint)',
  red:        'var(--danger)',
  green:      'var(--success)',
};

const s = {
  page: {
    padding: '28px 32px',
    background: T.bg,
    minHeight: '100vh',
  },
  statsRow: { display: 'flex', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' },
  grid: {
    display: 'grid',
    gridTemplateColumns: '3fr 4fr',
    gap: '20px',
  },
  card: {
    background: T.surface,
    borderRadius: '14px',
    padding: '22px 24px',
    border: `1px solid ${T.border}`,
    boxShadow: 'var(--shadow-sm)',
  },
  cardTitle: {
    margin: '0 0 18px',
    fontSize: '13px',
    fontWeight: 700,
    color: T.text,
    letterSpacing: '-0.1px',
  },
};

const Skeleton = ({ w = '100%', h = 16, r = 6 }) => (
  <div style={{
    width: w, height: h, borderRadius: r,
    background: 'linear-gradient(90deg, var(--gray-100) 25%, var(--gray-200) 50%, var(--gray-100) 75%)',
    backgroundSize: '200% 100%',
    animation: 'shimmer 1.4s infinite',
  }} />
);

export default function Overview() {
  const { selectedAccountId } = useAccount();
  const { accounts = [] } = useOutletContext() ?? {};
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchOverview = useCallback(() => {
    if (!selectedAccountId) { setData(null); return; }
    // "All accounts" aggregates across every owned account; otherwise a single id.
    const isAll = selectedAccountId === ALL_ACCOUNTS;
    const allIds = accounts.map(a => a.id).join(',');
    if (isAll && !allIds) { setData(null); return; }
    const query = isAll ? `accountIds=${allIds}` : `accountId=${selectedAccountId}`;
    setLoading(true);
    api.get(`/dashboard?${query}`)
      .then(res => setData(res.data))
      .catch(err => { console.error('Failed to fetch overview', err); setData(null); })
      .finally(() => setLoading(false));
  }, [selectedAccountId, accounts]);

  useEffect(() => { fetchOverview(); }, [fetchOverview]);

  const totalIncome = data?.totalIncome ?? 0;
  const totalSpends = data?.totalSpends ?? 0;
  const netFlow     = totalIncome - totalSpends;
  const netPositive = netFlow >= 0;
  const topMerchants = data?.topMerchants ?? [];
  const recent       = data?.recentTransactions ?? [];
  const maxMerchant  = topMerchants.reduce((m, x) => Math.max(m, x.amount), 0);

  const isEmpty = !loading && data && (data.totalTransactions ?? 0) === 0;

  return (
    <div style={s.page}>
      <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>

      {/* ── Stat cards ── */}
      <div style={s.statsRow}>
        <StatCard
          label="Total Income"
          value={loading ? '—' : fmt.format(totalIncome)}
          valueColor="#34d399"
        />
        <StatCard
          label="Total Spends"
          value={loading ? '—' : fmt.format(totalSpends)}
          valueColor="#f87171"
        />
        <StatCard
          label="Net Flow"
          value={loading ? '—' : `${netPositive ? '+' : ''}${fmt.format(netFlow)}`}
          valueColor={netPositive ? '#34d399' : '#f87171'}
          sub={loading ? '' : (netPositive ? 'Positive cash flow' : 'Negative cash flow')}
          accent={netPositive ? '#34d399' : '#f87171'}
        />
        <StatCard
          label="Transactions"
          value={loading ? '—' : (data?.totalTransactions ?? 0).toLocaleString('en-IN')}
          accent={T.indigoSoft}
        />
      </div>

      {!selectedAccountId ? (
        <div style={s.card}>
          <EmptyState icon="🏦" title="No account selected" subtitle="Pick an account from the header to see its overview." />
        </div>
      ) : isEmpty ? (
        <div style={s.card}>
          <EmptyState icon="📊" title="No transactions yet" subtitle="Upload a statement to see your income, spends, and top merchants here." />
        </div>
      ) : (
        <div style={s.grid}>
          {/* ── Top merchants ── */}
          <div style={s.card}>
            <p style={s.cardTitle}>Top Merchants</p>
            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {[...Array(5)].map((_, i) => <Skeleton key={i} h={20} />)}
              </div>
            ) : topMerchants.length === 0 ? (
              <EmptyState icon="🏬" title="No merchant spend" subtitle="Nothing to rank yet." compact />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {topMerchants.map((m, i) => {
                  const pct = maxMerchant > 0 ? (m.amount / maxMerchant) * 100 : 0;
                  return (
                    <div
                      key={i}
                      onClick={() => navigate('/insights')}
                      title="View spending insights"
                      style={{ cursor: 'pointer' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', marginBottom: '5px' }}>
                        <span style={{
                          fontSize: '13px', fontWeight: 600, color: T.text,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {m.name}
                        </span>
                        <span className="tnum" style={{ fontSize: '13px', fontWeight: 700, color: T.red, flexShrink: 0 }}>
                          {fmt.format(m.amount)}
                        </span>
                      </div>
                      <div style={{ height: '7px', background: T.borderSub, borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{
                          width: `${Math.max(pct, 2)}%`, height: '100%',
                          background: T.indigo, borderRadius: '4px', transition: 'width 0.5s ease',
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Recent transactions ── */}
          <div style={s.card}>
            <p style={s.cardTitle}>Recent Activity</p>
            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {[...Array(5)].map((_, i) => <Skeleton key={i} h={20} />)}
              </div>
            ) : recent.length === 0 ? (
              <EmptyState icon="📭" title="No recent transactions" subtitle="Nothing to show yet." compact />
            ) : (
              <div>
                {recent.map((tx, i) => {
                  const income = tx.amount >= 0;
                  return (
                    <div
                      key={tx.id ?? i}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '12px',
                        padding: '12px 0',
                        borderBottom: i < recent.length - 1 ? `1px solid ${T.borderSub}` : 'none',
                      }}
                    >
                      <div style={{
                        width: '38px', height: '38px', borderRadius: '10px',
                        background: income ? 'var(--success-light)' : T.indigoDim,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, fontSize: '16px',
                      }}>
                        {income ? '💰' : '💳'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{
                          margin: 0, fontSize: '13px', fontWeight: 600, color: T.text,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {tx.name || '—'}
                        </p>
                        <p style={{ margin: '2px 0 0', fontSize: '11px', color: T.muted }}>
                          {tx.date ? formatDate(tx.date) : '—'}{tx.mode ? ` · ${tx.mode}` : ''}
                        </p>
                      </div>
                      <p className="tnum" style={{
                        margin: 0, fontSize: '13px', fontWeight: 700, flexShrink: 0,
                        color: income ? T.green : T.red,
                      }}>
                        {income ? '+' : '−'}{fmt.format(Math.abs(tx.amount))}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
