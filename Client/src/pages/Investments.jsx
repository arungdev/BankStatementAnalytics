import { useState, useEffect } from 'react';
import { FiRefreshCw, FiLock, FiCheckCircle, FiClock } from 'react-icons/fi';
import api from '../api/client';
import StatCard from '../components/StatCard';
import EmptyState from '../components/EmptyState';
import { currencyFormatter as fmt } from '../utils/format';

/* ─── Design tokens — aligned with Overview / Insights ─────────── */
const T = {
  indigo:     '#4f46e5',
  indigoDim:  '#eef2ff',
  indigoSoft: '#a5b4fc',
  surface:    '#ffffff',
  bg:         '#f3f4f6',
  border:     '#e5e7eb',
  borderSub:  '#f0f1f3',
  text:       '#111827',
  muted:      '#6b7280',
  faint:      '#9ca3af',
  green:      '#10b981',
  greenDim:   '#ecfdf5',
  amber:      '#f59e0b',
};

const fmtDate = (d) =>
  new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

const s = {
  page: { padding: '28px 32px', background: T.bg, minHeight: '100vh', fontFamily: "'Inter', 'system-ui', sans-serif" },
  statsRow: { display: 'flex', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', alignItems: 'start' },
  card: {
    background: T.surface, borderRadius: '14px', padding: '22px 24px',
    border: `1px solid ${T.border}`, boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
  },
  cardTitle: { margin: '0 0 4px', fontSize: '13px', fontWeight: 700, color: T.text },
  cardSub: { margin: '0 0 18px', fontSize: '12px', color: T.muted },
  iconBox: (bg, fg) => ({
    width: '38px', height: '38px', borderRadius: '10px', background: bg,
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: fg,
  }),
};

export default function Investments() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/deposits')
      .then((res) => setData(res.data))
      .catch((err) => { console.error('Failed to fetch deposits', err); setData(null); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="loader-container">
        <div className="spinner"></div>
        <div className="loader-text">Loading investments...</div>
      </div>
    );
  }

  const rds = data?.recurringDeposits ?? [];
  const fds = data?.fixedDeposits ?? [];
  const empty = rds.length === 0 && fds.length === 0;

  return (
    <div style={s.page}>
      {/* ── Stat cards ── */}
      <div style={s.statsRow}>
        <StatCard
          label="Total invested"
          value={fmt.format(data?.totalInvested ?? 0)}
          accent={T.indigoSoft}
          sub="RD contributions + FD principal"
        />
        <StatCard
          label="Monthly RD commitment"
          value={fmt.format(data?.monthlyRdCommitment ?? 0)}
          valueColor="#6366f1"
          sub={`${data?.rdPlanCount ?? 0} recurring deposit${(data?.rdPlanCount ?? 0) === 1 ? '' : 's'}`}
        />
        <StatCard
          label="Fixed deposits"
          value={fmt.format(data?.totalFdPrincipal ?? 0)}
          valueColor="#0ea5e9"
          sub={`${data?.activeFdCount ?? 0} active`}
        />
        <StatCard
          label="FD returns received"
          value={fmt.format(data?.totalFdReturns ?? 0)}
          valueColor="#34d399"
          sub="Matured / interest credited"
        />
      </div>

      {empty ? (
        <div style={s.card}>
          <EmptyState
            icon="🏦"
            title="No deposits detected"
            subtitle="RD installments and fixed deposits from your statements will show up here automatically."
          />
        </div>
      ) : (
        <div style={s.grid}>
          {/* ── Recurring Deposits ── */}
          <div style={s.card}>
            <p style={s.cardTitle}>Recurring Deposits</p>
            <p style={s.cardSub}>
              {fmt.format(data.monthlyRdCommitment)}/month across {rds.length} plan{rds.length === 1 ? '' : 's'}
            </p>
            {rds.length === 0 ? (
              <EmptyState icon="🔁" title="No RDs" subtitle="No recurring-deposit installments found." compact />
            ) : (
              <div>
                {rds.map((r, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 0',
                    borderBottom: i < rds.length - 1 ? `1px solid ${T.borderSub}` : 'none',
                  }}>
                    <div style={s.iconBox(T.indigoDim, T.indigo)}>
                      <FiRefreshCw size={16} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {r.name}
                      </p>
                      <p style={{ margin: '2px 0 0', fontSize: '11px', color: T.muted }}>
                        {r.installmentsPaid} paid · {fmt.format(r.totalInvested)} so far · next ~{fmtDate(r.nextInstallmentDate)}
                      </p>
                    </div>
                    <p style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: T.indigo, flexShrink: 0 }}>
                      {fmt.format(r.monthlyAmount)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Fixed Deposits ── */}
          <div style={s.card}>
            <p style={s.cardTitle}>Fixed Deposits</p>
            <p style={s.cardSub}>
              {fmt.format(data.totalFdPrincipal)} principal · {data.activeFdCount} active
            </p>
            {fds.length === 0 ? (
              <EmptyState icon="🔒" title="No FDs" subtitle="No fixed-deposit transactions found." compact />
            ) : (
              <div>
                {fds.map((f, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 0',
                    borderBottom: i < fds.length - 1 ? `1px solid ${T.borderSub}` : 'none',
                  }}>
                    <div style={s.iconBox(f.isMatured ? T.greenDim : T.indigoDim, f.isMatured ? T.green : T.indigo)}>
                      {f.isMatured ? <FiCheckCircle size={16} /> : <FiLock size={16} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {f.name}
                      </p>
                      <p style={{ margin: '2px 0 0', fontSize: '11px', color: T.muted, display: 'flex', alignItems: 'center', gap: '5px' }}>
                        {f.isMatured
                          ? <><FiCheckCircle size={11} style={{ color: T.green }} /> Matured · {fmt.format(f.returns)} received{f.netGain > 0 ? ` · +${fmt.format(f.netGain)} gain` : ''}</>
                          : <><FiClock size={11} style={{ color: T.amber }} /> Placed {fmtDate(f.placedOn)}</>}
                      </p>
                    </div>
                    <p style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: f.isMatured ? T.green : T.text, flexShrink: 0 }}>
                      {fmt.format(f.principal > 0 ? f.principal : f.returns)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
