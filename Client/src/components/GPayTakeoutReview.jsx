import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { currencyFormatter, maskName, formatDate } from '../utils/format';
import { usePrivacy } from '../context/usePrivacy';
import { getCandidateTransactions } from '../api/splits';
import './GPayTakeoutReview.css';
import GPayActivityTable from './GPayActivityTable';
import GPayActivityDrawer from './GPayActivityDrawer';

const root = '/split-groups/evidence';
const message = error => error.response?.data?.message || error.message;
const date = value => value ? formatDate(value) : '—';
const bankKey = bank => ({ accountId: bank.accountId, bankReference: bank.bankReference, bankType: bank.bankType, transactionType: bank.transactionType });

export default function GPayTakeoutReview({ onRefresh, onTransaction, onPanelWidthChange }) {
  usePrivacy();
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [viewport, setViewport] = useState(() => window.innerWidth);
  const [sidebarWidth, setSidebarWidth] = useState(450);
  const recordTrigger = useRef(null);
  useEffect(() => {
    onPanelWidthChange?.(selectedRecord && viewport > 1024 ? sidebarWidth : 0);
  }, [selectedRecord, viewport, sidebarWidth, onPanelWidthChange]);
  useEffect(() => () => onPanelWidthChange?.(0), [onPanelWidthChange]);
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const [settlementFilter,setSettlementFilter] = useState('active'), [tab, setTab] = useState('activities'), [search, setSearch] = useState(''), [page, setPage] = useState(0);
  const [undo,setUndo] = useState(null), [repair, setRepair] = useState(null), [matching, setMatching] = useState(null), [matches, setMatches] = useState(null), [days, setDays] = useState(7);
  const [allocation, setAllocation] = useState(null), [bankSearch, setBankSearch] = useState(''), [bankRows, setBankRows] = useState([]), [selectedBank, setSelectedBank] = useState(null), [amount, setAmount] = useState('');
  const reload = useCallback(async () => { const response = await api.get(root); setData(response.data); }, []);
  useEffect(() => { let live = true; api.get(root).then(r => { if (live) setData(r.data); }).catch(e => { if (live) setError(message(e)); }); return () => { live = false; }; }, []);
  const run = async action => { setBusy(true); setError(''); try { await action(); await reload(); await onRefresh?.(); } catch (e) { setError(message(e)); } finally { setBusy(false); } };
  const find = async (target, window = days) => {
    setSelectedRecord(null);
    setMatching(target); setMatches(null); setError(''); setBusy(true);
    try { setMatches((await api.get(`${root}/candidates`, { params: { memberId: target.memberId, recordId: target.recordId, days: window } })).data); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  const startAllocation = member => { setAllocation(member); setBankRows([]); setSelectedBank(null); setBankSearch(''); setAmount(''); };
  const queryBanks = async () => { setBusy(true); setError(''); try { setBankRows((await getCandidateTransactions(allocation.direction === 'To collect' ? 'credit' : 'debit', bankSearch)).data); } catch (e) { setError(message(e)); } finally { setBusy(false); } };
  const filtered = rows => rows.filter(row => JSON.stringify(row).toLowerCase().includes(search.toLowerCase()));
  const paginate = rows => rows.slice(page * 30, page * 30 + 30);
  const exportReport = () => { const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'gpay-reconciliation.json'; link.click(); URL.revokeObjectURL(url); };
  const changeTab = key => { setTab(key); setPage(0); setSearch(''); setMatching(null); setAllocation(null); setSelectedRecord(null); };
  const selectRecord = (record, row) => { recordTrigger.current = row.querySelector('.gpay-activity-detail-link'); setSelectedRecord({ record, kind: tab }); };
  const closeRecord = () => { setSelectedRecord(null); recordTrigger.current?.focus(); };
  const openBank = bank => onTransaction?.({ ...bankKey(bank), expenseTitle: matching?.title || allocation?.title || 'Takeout source', participantName: matching?.participantName || allocation?.participantName });
  const tabs = [['activities', 'Payment history'], ['orders', 'Digital orders'], ['rewards', 'Cashback'], ['vouchers', 'Vouchers']];
  const rows = data ? filtered(tab === 'history' ? data.decisions || [] : tab === 'repairs' ? data.repairs || [] : tab === 'settlements' ? (data.settlements || []).filter(m => settlementFilter === 'all' || m.eligibleFlow && (settlementFilter === 'history' ? !m.active : m.active) && (settlementFilter === 'to_collect' ? m.direction === 'To collect' : settlementFilter === 'owed' ? m.direction === 'Owed by me' : true)) : data[tab] || []) : [];
  return <section className="gpay-review" aria-label="Google Pay source and reconciliation">
    <header className="gpay-review-heading"><div><h2>GPay Activity</h2><p>Browse payments, purchases, rewards, and vouchers from your GPay import.</p></div><button className="btn btn--outline" disabled={!data || busy} onClick={exportReport}>Export records</button></header>
    {error && <div role="alert" className="gpay-review-error">{error}<button onClick={() => { setError(''); reload().catch(e => setError(message(e))); }}>Retry</button></div>}
    <nav className="gpay-review-tabs" aria-label="Takeout review sections">{tabs.map(([key, label]) => <button key={key} aria-current={tab === key ? 'page' : undefined} onClick={() => changeTab(key)}>{label}</button>)}</nav>
    {!data && !error && <p role="status">Loading source records…</p>}
    {data && <>
      <label className="gpay-review-search">Search this section<input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="Name, title, date, state or reference" /></label>
      {tab === 'repairs' && <><p>Source repairs preserve bank links and store a before snapshot. Conflicts require separate bank-link review.</p>{data.duplicateLinks?.map(conflict => <details className="gpay-review-panel" key={conflict.key}><summary>Shared bank link · {maskName(conflict.key)} ({conflict.members.length} participants)</summary>{conflict.members.map(m => <p key={m.id}>{maskName(m.participantName)} · split {m.splitId} · {currencyFormatter.format(m.paidAmount)}</p>)}</details>)}{data.linkWarnings?.map(w => <p className="gpay-review-warning" key={w.memberId}>Split {w.splitId} · {maskName(w.participantName)}: {w.reason}</p>)}
        {paginate(rows).map(r => <article className="gpay-review-panel" key={r.recordId}><h3>{maskName(r.title)}</h3><p>{maskName(r.reason)}</p>{repair?.recordId === r.recordId ? <div><p>Apply this source interpretation to split {r.splitId}? Existing bank-linked amounts are preserved.</p><button className="btn btn--primary" disabled={busy} onClick={() => run(async () => { await api.post(`${root}/repair`, { recordId: r.recordId, expectedFingerprint: r.before }); setRepair(null); })}>Apply reviewed repair</button><button className="btn btn--outline" onClick={() => setRepair(null)}>Cancel</button></div> : <button className="btn btn--outline" disabled={!r.canApply || busy} onClick={() => setRepair(r)}>Review repair</button>}</article>)}
      </>}
      {tab === 'settlements' && <><label>Show<select value={settlementFilter} onChange={e=>{setSettlementFilter(e.target.value);setPage(0);}}><option value="active">My active repayment flows</option><option value="to_collect">To collect</option><option value="owed">Owed by me</option><option value="history">Closed repayment history</option><option value="all">All observed participants</option></select></label><p>Amounts are source snapshots, not live balances. Aging is time since split creation, not a due date. Closed records remain history.</p><div className="gpay-review-table"><table><thead><tr><th>Bill / participant</th><th>Direction</th><th>Assigned</th><th>Recorded paid</th><th>Outstanding</th><th>Evidence</th><th>Actions</th></tr></thead><tbody>{paginate(rows).map(m => <tr key={m.id}><td>{maskName(m.title)}<small>{maskName(m.participantName)} · {m.ageDays} days since creation</small></td><td>{!m.eligibleFlow ? 'Other participant / personal share' : m.active ? m.direction : 'Closed history'}{m.isOwner && <small>Personal share</small>}</td><td>{currencyFormatter.format(m.assignedAmount)}</td><td>{currencyFormatter.format(m.paidAmount)}</td><td>{currencyFormatter.format(Math.max(0,m.assignedAmount-m.paidAmount))}</td><td>{m.settlementEvidence || 'Legacy — review'}<small>{m.sourceState || 'Source state not attached'}</small></td><td>{m.eligibleFlow && <><button disabled={busy} onClick={() => find({ memberId: m.id, title: m.title, participantName: m.participantName })}>Find repayment</button><button disabled={busy} onClick={() => startAllocation(m)}>Allocate payment</button></>}</td></tr>)}</tbody></table></div></>}
      {['activities','orders','rewards','vouchers'].includes(tab) && <>
        <p>{tab === 'activities' ? 'Activity identifiers are source IDs, not verified bank UPI references. Only completed activities can be confirmed against a bank transaction.' : tab === 'orders' ? 'Order history includes cancellations and refunds. Google Play balance purchases are not assumed bank debits.' : tab === 'rewards' ? 'Earned rewards are separate from confirmed bank receipts.' : 'Not expired does not mean unused or redeemable.'}</p>
        <GPayActivityTable key={tab} records={rows} kind={tab} busy={busy} onReview={find} onSelect={selectRecord} selectedId={selectedRecord?.record.id} page={page} onPageChange={setPage} />
      </>}
      {tab === 'allocations' && <><p>Each allocation uses part of a confirmed bank payment. Removing it restores source-reported settlement when no bank allocation remains.</p><div className="gpay-review-table"><table><thead><tr><th>Split / member</th><th>Bank transaction</th><th>Amount</th><th>Action</th></tr></thead><tbody>{paginate(rows).map(a => <tr key={a.id}><td>Split {a.splitId} · member {a.memberId}</td><td><button onClick={() => openBank(a)}>{maskName(a.bankReference)}</button></td><td>{currencyFormatter.format(a.amount)}</td><td><button disabled={busy} onClick={() => run(() => api.delete(`${root}/allocations/${a.id}`))}>Remove allocation</button></td></tr>)}</tbody></table></div></>}
      {tab === 'history' && paginate(rows).map((h,i) => <details className="gpay-review-panel" key={i}><summary>{h.kind} · {date(h.createdUtc)}</summary><pre>{maskName(JSON.stringify(h.data,null,2))}</pre>{h.kind === 'RepairAudit' && (undo === h.id ? <div><p>Restore this repair's before snapshot? This is allowed only if the expense has not changed since the repair.</p><button disabled={busy} onClick={() => run(async()=>{await api.post(`${root}/repair/${h.id}/undo`);setUndo(null);})}>Confirm undo repair</button><button onClick={()=>setUndo(null)}>Cancel</button></div> : <button onClick={()=>setUndo(h.id)}>Review undo repair</button>)}</details>)}
      {rows.length === 0 && <p>No records in this section. Import an export or adjust the search.</p>}
      {!['activities','orders','rewards','vouchers'].includes(tab) && <div className="gpay-review-pagination"><button disabled={page === 0} onClick={() => setPage(p => p-1)}>Previous</button><span>{rows.length === 0 ? 0 : page*30+1}–{Math.min(rows.length,(page+1)*30)} of {rows.length}</span><button disabled={(page+1)*30 >= rows.length} onClick={() => setPage(p => p+1)}>Next</button></div>}
    </>}
    {matching && <section className="gpay-review-panel"><div className="gpay-review-heading"><h3>Bank candidates · {maskName(matching.title)}</h3><button onClick={() => setMatching(null)}>Close</button></div><label>Search window<select value={days} onChange={e => { const value=Number(e.target.value); setDays(value); find(matching,value); }}><option value={1}>±1 day</option><option value={7}>±7 days</option><option value={30}>±30 days</option><option value={90}>±90 days</option></select></label><p>{matches?.reason}</p>{matches?.candidates?.length === 0 && <p>No eligible candidates. Extend the window or manually review the bank statement.</p>}{matches?.candidates?.map(c => <article className="gpay-review-candidate" key={`${c.accountId}-${c.bankReference}-${c.bankType}-${c.transactionType}`}><button onClick={() => openBank(c)}>{maskName(c.bankReference)}</button><strong>{currencyFormatter.format(c.amount)}</strong><span>{date(c.transactionDate)} · {c.confidence} · {c.decision}</span><p>{maskName(c.description)}</p><ul>{c.reasons.map(r => <li key={r}>{r}</li>)}</ul>{matching.recordId ? <div><button disabled={busy || c.decision === 'Confirmed'} onClick={() => run(async () => { await api.post(`${root}/review`,{recordId:matching.recordId,accept:true,...bankKey(c)}); await find(matching); })}>Confirm source-to-bank match</button><button disabled={busy || c.decision === 'Rejected'} onClick={() => run(async () => { await api.post(`${root}/review`,{recordId:matching.recordId,accept:false,...bankKey(c)}); await find(matching); })}>Reject candidate</button></div> : <button disabled={busy} onClick={() => { const m=data.settlements.find(m => m.id===matching.memberId); startAllocation(m); setSelectedBank(c); setAmount(String(Math.max(0,m.assignedAmount-(data.allocations||[]).filter(a=>a.memberId===m.id).reduce((s,a)=>s+a.amount,0)))); }}>Review payment allocation</button>}</article>)}</section>}
    {allocation && <section className="gpay-review-panel"><div className="gpay-review-heading"><h3>Allocate {allocation.direction === 'To collect' ? 'incoming credit' : 'repayment debit'} · {maskName(allocation.participantName)}</h3><button onClick={() => setAllocation(null)}>Close</button></div><p>Confirm the bank payment and the amount applied to this share. Bank capacity and participant limits are checked before saving.</p><div className="gpay-review-form"><label>Search bank transactions<input value={bankSearch} onChange={e => setBankSearch(e.target.value)} /></label><button disabled={busy} onClick={queryBanks}>Search</button></div>{bankRows.map(b => <button className="gpay-review-bank-option" key={`${b.accountId}-${b.bankReference}-${b.bankType}-${b.transactionType}`} onClick={() => { setSelectedBank(b); setAmount(''); }}>{maskName(b.bankReference)} · {currencyFormatter.format(b.credit || b.debit || b.amount)} · {date(b.date || b.transactionDate)}</button>)}{selectedBank && <div className="gpay-review-form"><button onClick={() => openBank(selectedBank)}>{maskName(selectedBank.bankReference)}</button><label>Amount applied to this share<input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></label><button disabled={busy || Number(amount)<=0} onClick={() => run(async () => { await api.post(`${root}/allocations`,{splitId:allocation.splitId,memberId:allocation.id,amount:Number(amount),...bankKey(selectedBank)});setAllocation(null);setMatching(null); })}>Confirm allocation</button></div>}</section>}
    <GPayActivityDrawer selection={selectedRecord} onClose={closeRecord} onReview={find} busy={busy} width={sidebarWidth} onWidthChange={setSidebarWidth} />
  </section>;
}
