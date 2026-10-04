import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Drawer } from '@common/client';
import { FiArrowRight, FiUsers } from 'react-icons/fi';
import { getSharedBillSummary } from '../api/splits';
import { currencyFormatter as fmt, formatDate, maskName } from '../utils/format';
import { usePrivacy } from '../context/usePrivacy';
import './SharedBills.css';

export default function SharedBillSummary({ accountId = 0, startDate, endDate, report = false }) {
  usePrivacy();
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [drawer, setDrawer] = useState(null);
  const closeButtonRef = useRef(null);
  const requestKey = JSON.stringify({ accountId, startDate, endDate, attempt });
  useEffect(() => {
    const controller = new AbortController();
    const params = JSON.parse(requestKey);
    delete params.attempt;
    getSharedBillSummary(params, controller.signal)
      .then(res => { if (!controller.signal.aborted) setResult({ key: requestKey, data: res.data }); })
      .catch(() => { if (!controller.signal.aborted) setResult({ key: requestKey, error: true }); });
    return () => controller.abort();
  }, [requestKey]);

  const current = result?.key === requestKey ? result : null;
  const data = current?.data;
  const open = drawer?.key === requestKey;
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement;
    closeButtonRef.current?.focus();
    const onKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); setDrawer(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);
  const rows = (data?.outstandingBills || []).filter(bill =>
    drawer?.filter === 'collect' ? bill.isCreatedByUser : drawer?.filter === 'owe' ? !bill.isCreatedByUser : true);
  const showBills = filter => setDrawer({ key: requestKey, filter });
  const scope = accountId ? 'Bills with bank links to this account' : 'All profiles and custom bills';
  const metric = (label, value, filter, className) => <button type="button" className={`shared-bills-metric ${className || ''}`}
    onClick={() => showBills(filter)} title={`Show ${label.toLowerCase()} bills`}>
    <span>{label}<FiArrowRight aria-hidden="true" /></span><strong className="tnum">{fmt.format(value)}</strong>
  </button>;

  return <>
    <section className="shared-bills-summary no-print" aria-label={report ? 'Shared bills in this period' : 'Shared bill balances'}>
      <header><div><h2><FiUsers aria-hidden="true" />{report ? 'Shared bills in this period' : 'Shared bill balances'}</h2>
        <p>{scope}{data ? ` · ${data.billCount} ${data.billCount === 1 ? 'bill' : 'bills'}` : ''}</p></div>
        <Link className="shared-bills-link" to="/splits">Bill Splits <FiArrowRight aria-hidden="true" /></Link></header>
      {!current && <p role="status">Loading shared bills…</p>}
      {current?.error && <p role="alert">Could not load shared bills. <button className="shared-bills-link" onClick={() => setAttempt(value => value + 1)}>Retry</button></p>}
      {data && data.billCount === 0 && <p>No {accountId ? 'bank-linked ' : ''}shared bills{report ? ' dated in this period' : ''}.</p>}
      {data?.billCount > 0 && <>
        <div className={`shared-bills-metrics ${report ? 'is-report' : ''}`}>
          {report && <div className="shared-bills-metric"><span>Total bill volume</span><strong className="tnum">{fmt.format(data.totalBillVolume)}</strong></div>}
          {report && <div className="shared-bills-metric"><span>My share</span><strong className="tnum">{fmt.format(data.myShare)}</strong></div>}
          {metric('To collect', data.toCollect, 'collect', 'is-collect')}
          {metric('Owed by me', data.owedByMe, 'owe', 'is-owe')}
        </div>
        <footer><span>{report ? 'Bills dated in the selected period; balances reflect current recorded settlements.' : 'Current recorded balances. Bank verification is shown in each expense.'}</span>
          <button className="shared-bills-link" onClick={() => showBills('all')}>View outstanding bills <FiArrowRight aria-hidden="true" /></button></footer>
      </>}
    </section>
    <Drawer open={!!open} onClose={() => setDrawer(null)} title={drawer?.filter === 'collect' ? 'Bills to collect' : drawer?.filter === 'owe' ? 'Bills I owe' : 'Outstanding shared bills'} width={420}>
      <div className="shared-bills-drawer"><button ref={closeButtonRef} className="shared-bills-link" onClick={() => setDrawer(null)}>Back to summary</button><p>{scope}. {report ? 'Bills dated in the selected period. ' : ''}Current recorded balances.</p>
        {rows.length === 0 && <p>No outstanding bills in this view.</p>}
        {rows.map(bill => <Link className="shared-bill-row" key={bill.id} to={`/splits?splitId=${bill.id}`}>
          <div><strong>{maskName(bill.title)}</strong><small>{bill.groupName ? `${maskName(bill.groupName)} · ` : ''}{formatDate(bill.date)}</small></div>
          <div><strong className="tnum">{fmt.format(bill.pendingAmount)}</strong><small>{bill.isCreatedByUser ? 'Owed to you' : 'You owe'}</small></div><FiArrowRight aria-hidden="true" />
        </Link>)}
      </div>
    </Drawer>
  </>;
}
