import { useState, useEffect, useCallback } from 'react';
import { FiRefreshCw, FiLock, FiCheckCircle, FiClock, FiEdit2, FiTrash2 } from 'react-icons/fi';
import api from '../api/client';
import StatCard from '../components/StatCard';
import EmptyState from '../components/EmptyState';
import Drawer from '../components/ui/Drawer';
import Avatar from '../components/ui/Avatar';
import { currencyFormatter as fmt } from '../utils/format';

/* ─── Design tokens — aligned with Overview / Forecast / Insights ─────────── */
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
  red:        '#ef4444',
};

const fmtDate = (d) =>
  new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

// ISO datetime → yyyy-mm-dd for <input type="date">.
const toDateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

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
  row: (last) => ({
    display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 0',
    borderBottom: last ? 'none' : `1px solid ${T.borderSub}`, cursor: 'pointer',
  }),
  metaLabel: { display: 'block', fontSize: '12px', fontWeight: 600, color: T.muted, marginBottom: '4px' },
};

export default function Investments() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState(null);   // { kind, ...deposit }
  const [drawerWidth, setDrawerWidth] = useState(460);
  const [txns, setTxns] = useState([]);
  const [loadingTxns, setLoadingTxns] = useState(false);
  const [form, setForm] = useState(null);           // editable metadata
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    return api.get('/deposits')
      .then((res) => setData(res.data))
      .catch((err) => { console.error('Failed to fetch deposits', err); setData(null); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const openDeposit = (kind, d) => {
    setSelected({ kind, ...d });
    setForm({
      nickname: d.name ?? '',
      interestRate: d.interestRate ?? '',
      maturityDate: toDateInput(d.maturityDate),
      termMonths: d.termMonths ?? '',
      note: d.note ?? '',
    });
    setTxns([]);
    setLoadingTxns(true);
    api.get('/deposits/transactions', { params: { kind, matchKey: d.matchKey } })
      .then((res) => setTxns(res.data || []))
      .catch((err) => console.error(err))
      .finally(() => setLoadingTxns(false));
  };

  const closeDrawer = () => { setSelected(null); setForm(null); setTxns([]); };

  const saveMeta = () => {
    if (!selected) return;
    setSaving(true);
    api.put('/deposits', {
      kind: selected.kind,
      matchKey: selected.matchKey,
      nickname: form.nickname?.trim() || null,
      interestRate: form.interestRate === '' ? null : Number(form.interestRate),
      maturityDate: form.maturityDate || null,
      termMonths: form.termMonths === '' ? null : Number(form.termMonths),
      note: form.note?.trim() || null,
    })
      .then(load)
      .then(() => closeDrawer())
      .catch((err) => { console.error(err); alert('Failed to save details.'); })
      .finally(() => setSaving(false));
  };

  const resetMeta = () => {
    if (!selected) return;
    if (!window.confirm('Clear the saved details for this deposit?')) return;
    setSaving(true);
    api.delete('/deposits', { params: { kind: selected.kind, matchKey: selected.matchKey } })
      .then(load)
      .then(() => closeDrawer())
      .catch((err) => console.error(err))
      .finally(() => setSaving(false));
  };

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
    <div style={{ ...s.page, marginRight: selected ? drawerWidth : 0, transition: 'margin-right 0.2s ease' }}>
      {/* ── Stat cards ── */}
      <div style={s.statsRow}>
        <StatCard label="Total invested" value={fmt.format(data?.totalInvested ?? 0)} accent={T.indigoSoft} sub="RD contributions + FD principal" />
        <StatCard label="Monthly RD commitment" value={fmt.format(data?.monthlyRdCommitment ?? 0)} valueColor="#6366f1" sub={`${data?.rdPlanCount ?? 0} recurring deposit${(data?.rdPlanCount ?? 0) === 1 ? '' : 's'}`} />
        <StatCard label="Fixed deposits" value={fmt.format(data?.totalFdPrincipal ?? 0)} valueColor="#0ea5e9" sub={`${data?.activeFdCount ?? 0} active`} />
        <StatCard label="FD returns received" value={fmt.format(data?.totalFdReturns ?? 0)} valueColor="#34d399" sub="Matured / interest credited" />
      </div>

      {empty ? (
        <div style={s.card}>
          <EmptyState icon="🏦" title="No deposits detected" subtitle="RD installments and fixed deposits from your statements will show up here automatically." />
        </div>
      ) : (
        <div style={s.grid}>
          {/* ── Recurring Deposits ── */}
          <div style={s.card}>
            <p style={s.cardTitle}>Recurring Deposits</p>
            <p style={s.cardSub}>{fmt.format(data.monthlyRdCommitment)}/month across {rds.length} plan{rds.length === 1 ? '' : 's'}</p>
            {rds.length === 0 ? (
              <EmptyState icon="🔁" title="No RDs" subtitle="No recurring-deposit installments found." compact />
            ) : (
              <div>
                {rds.map((r, i) => (
                  <div key={r.matchKey} style={s.row(i === rds.length - 1)} onClick={() => openDeposit('RD', r)} title="View & edit">
                    <div style={s.iconBox(T.indigoDim, T.indigo)}><FiRefreshCw size={16} /></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {r.name}
                      </p>
                      <p style={{ margin: '2px 0 0', fontSize: '11px', color: T.muted }}>
                        {r.installmentsPaid} paid · {fmt.format(r.totalInvested)} so far · next ~{fmtDate(r.nextInstallmentDate)}
                      </p>
                      {r.progressPct != null && (
                        <div style={{ marginTop: '7px' }}>
                          <div style={{ height: '5px', borderRadius: '999px', background: T.borderSub, overflow: 'hidden' }}>
                            <div style={{ width: `${r.progressPct}%`, height: '100%', background: T.indigo }} />
                          </div>
                          <p style={{ margin: '3px 0 0', fontSize: '10px', color: T.faint }}>
                            {r.installmentsPaid} of {r.termMonths} installments · {r.monthsRemaining} left
                            {r.maturityDate ? ` · matures ${fmtDate(r.maturityDate)}` : ''}
                          </p>
                        </div>
                      )}
                    </div>
                    <p style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: T.indigo, flexShrink: 0 }}>{fmt.format(r.monthlyAmount)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Fixed Deposits ── */}
          <div style={s.card}>
            <p style={s.cardTitle}>Fixed Deposits</p>
            <p style={s.cardSub}>{fmt.format(data.totalFdPrincipal)} principal · {data.activeFdCount} active</p>
            {fds.length === 0 ? (
              <EmptyState icon="🔒" title="No FDs" subtitle="No fixed-deposit transactions found." compact />
            ) : (
              <div>
                {fds.map((f, i) => (
                  <div key={f.matchKey} style={s.row(i === fds.length - 1)} onClick={() => openDeposit('FD', f)} title="View & edit">
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
                          : f.maturityDate
                            ? <><FiClock size={11} style={{ color: T.amber }} /> Matures {fmtDate(f.maturityDate)}{f.daysToMaturity != null && f.daysToMaturity >= 0 ? ` · ${f.daysToMaturity}d` : ''}</>
                            : <><FiClock size={11} style={{ color: T.amber }} /> Placed {fmtDate(f.placedOn)}</>}
                      </p>
                      {f.maturityValue != null && (
                        <p style={{ margin: '3px 0 0', fontSize: '10px', color: T.faint }}>
                          Projected maturity value {fmt.format(f.maturityValue)}{f.interestRate ? ` @ ${f.interestRate}%` : ''}
                        </p>
                      )}
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

      {/* ── Detail + edit drawer ── */}
      <Drawer open={!!selected} onClose={closeDrawer} title={selected?.kind === 'FD' ? 'Fixed deposit' : 'Recurring deposit'} width={drawerWidth} onWidthChange={setDrawerWidth} modal={false}>
        {selected && form && (
          <>
            {/* Summary header */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '8px 0 22px', borderBottom: `1px solid ${T.border}`, marginBottom: '22px' }}>
              <Avatar name={selected.name} size={52} />
              <div style={{ fontSize: '32px', fontWeight: 800, letterSpacing: '-0.5px', color: T.indigo }}>
                {fmt.format(selected.kind === 'FD' ? (selected.principal > 0 ? selected.principal : selected.returns) : selected.totalInvested)}
              </div>
              <div style={{ color: T.muted, fontSize: '14px', fontWeight: 600, textAlign: 'center' }}>{selected.name}</div>
              <div style={{ color: T.faint, fontSize: '12px', textAlign: 'center' }}>
                {selected.kind === 'FD'
                  ? `Placed ${fmtDate(selected.placedOn)}${selected.isMatured ? ` · matured` : ''}`
                  : `${selected.installmentsPaid} installments of ${fmt.format(selected.monthlyAmount)} · since ${fmtDate(selected.firstInstallmentDate)}`}
              </div>
            </div>

            {/* Editable metadata */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '11px', color: T.faint, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>Details</div>
              <label style={s.metaLabel}>Nickname</label>
              <input className="field-input" style={{ width: '100%', marginBottom: '12px' }} value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} placeholder={selected.name} />

              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <label style={s.metaLabel}>Interest rate (%)</label>
                  <input className="field-input" type="number" step="0.01" style={{ width: '100%', marginBottom: '12px' }} value={form.interestRate} onChange={(e) => setForm({ ...form, interestRate: e.target.value })} placeholder="e.g. 7.1" />
                </div>
                {selected.kind === 'RD' && (
                  <div style={{ flex: 1 }}>
                    <label style={s.metaLabel}>Tenure (months)</label>
                    <input className="field-input" type="number" style={{ width: '100%', marginBottom: '12px' }} value={form.termMonths} onChange={(e) => setForm({ ...form, termMonths: e.target.value })} placeholder="e.g. 12" />
                  </div>
                )}
              </div>

              <label style={s.metaLabel}>Maturity date</label>
              <input className="field-input" type="date" style={{ width: '100%', marginBottom: '12px' }} value={form.maturityDate} onChange={(e) => setForm({ ...form, maturityDate: e.target.value })} />

              <label style={s.metaLabel}>Note</label>
              <textarea className="field-input" rows={2} style={{ width: '100%', marginBottom: '14px', resize: 'vertical' }} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />

              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn primary" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }} onClick={saveMeta} disabled={saving}>
                  <FiEdit2 size={14} /> {saving ? 'Saving…' : 'Save details'}
                </button>
                <button className="btn" title="Clear saved details" onClick={resetMeta} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: '6px', color: T.red }}>
                  <FiTrash2 size={14} />
                </button>
              </div>
            </div>

            {/* Transaction history */}
            <div style={{ fontSize: '11px', color: T.faint, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>
              {loadingTxns ? 'Loading…' : `${txns.length} transaction${txns.length === 1 ? '' : 's'}`}
            </div>
            {!loadingTxns && txns.length === 0 ? (
              <EmptyState icon="📭" title="No transactions" subtitle="No transactions matched this deposit." compact />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {txns.map((t, idx) => (
                  <div key={`${t.bankReference}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 0', borderBottom: idx < txns.length - 1 ? `1px solid ${T.borderSub}` : 'none' }}>
                    <Avatar name={selected.name} size={36} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: T.text, fontSize: '13px' }}>{fmtDate(t.date)}</div>
                      <div style={{ fontSize: '11px', color: T.muted, marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description}</div>
                    </div>
                    <div style={{ fontWeight: 800, fontSize: '14px', color: t.isCredit ? T.green : T.indigo, whiteSpace: 'nowrap' }}>
                      {t.isCredit ? '+' : '−'}{fmt.format(t.amount)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Drawer>
    </div>
  );
}
