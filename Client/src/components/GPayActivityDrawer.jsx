import { useEffect, useRef, useState } from 'react';
import { Avatar, Drawer } from '@common/client';
import { FiArrowLeft, FiLink } from 'react-icons/fi';
import { currencyFormatterFull, maskName } from '../utils/format';
import { usePrivacy } from '../context/usePrivacy';
import './GPayActivityDrawer.css';

const titles = { activities: 'Payment details', orders: 'Order details', rewards: 'Cashback details', vouchers: 'Voucher details' };
const labels = { CounterPartyName: 'Recipient / sender', AccountSuffix: 'Account', RefId: 'GPay activity ID', TransactionId: 'Order transaction ID', PaymentMethod: 'Payment method', ExpiryTimestamp: 'Expires', Timestamp: 'Date and time', Time: 'Date and time', Date: 'Date', Type: 'Payment type' };
const dateFields = new Set(['Timestamp', 'Time', 'Date', 'ExpiryTimestamp']);

export default function GPayActivityDrawer({ selection, onClose, onBank, width = 450, onWidthChange }) {
  const { maskAmounts } = usePrivacy();
  const [viewport, setViewport] = useState(() => window.innerWidth);
  const closeButton = useRef(null);
  const closeCallback = useRef(onClose);
  useEffect(() => { closeCallback.current = onClose; });
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    if (!selection) return;
    closeButton.current?.focus();
    const onKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); closeCallback.current(); }
      if (event.key === 'Tab' && viewport <= 1024) {
        const panel = closeButton.current?.closest('.ui-drawer');
        const controls = [...(panel?.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]') || [])];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, viewport]);

  const record = selection?.record;
  let source = {};
  try { source = JSON.parse(record?.source?.data || '{}'); } catch { /* Display an unavailable-source message below. */ }
  const kind = selection?.kind;
  const name = source.CounterPartyName || source.Description || source.Summary || source.Type || 'GPay record';
  const direction = kind === 'rewards' || source.Type === 'Received' ? 'credit' : ['Paid', 'Sent'].includes(source.Type) ? 'debit' : '';
  const text = value => maskAmounts ? 'Hidden in privacy mode' : maskName(typeof value === 'object' ? JSON.stringify(value) : String(value));
  const display = (key, value) => {
    if (key === 'Amount') return currencyFormatterFull.format(value);
    if (dateFields.has(key)) {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? text(value) : date.toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', ...(key !== 'ExpiryTimestamp' && key !== 'Date' ? { hour: '2-digit', minute: '2-digit' } : {}) });
    }
    if (key === 'AccountSuffix') return `••••${text(value)}`;
    return key === 'Status' || key === 'Type' || key === 'Currency' ? String(value) : text(value);
  };
  const fields = Object.entries(source).filter(([, value]) => value !== null && value !== undefined && value !== '');
  return <Drawer open={!!selection} onClose={onClose} title={titles[kind] || 'GPay details'} width={viewport <= 640 ? viewport : Math.min(width, viewport)} onWidthChange={viewport > 1024 ? onWidthChange : undefined} modal={viewport <= 1024}>
    <section className="gpay-activity-details" role={viewport <= 1024 ? 'dialog' : 'region'} aria-modal={viewport <= 1024 ? true : undefined} aria-label="GPay record details">
      <button ref={closeButton} type="button" className="gpay-detail-back" onClick={onClose}><FiArrowLeft /> Back to records</button>
      <div className="gpay-detail-hero">
        <Avatar name={maskName(name) || '?'} size={48} />
        <h3>{maskName(name)}</h3>
        {record?.profileName && <span>{maskName(record.profileName)}</span>}
        {source.Amount !== undefined && source.Amount !== null && <strong className={`gpay-detail-amount ${direction ? `is-${direction}` : ''}`}>{direction === 'credit' ? '+' : direction === 'debit' ? '−' : ''}{currencyFormatterFull.format(source.Amount)}</strong>}
        {source.Status && <span>{source.Status}</span>}
      </div>
      <dl className="gpay-detail-fields">{fields.map(([key, value]) => <div key={key} className={['Description', 'Summary', 'Details', 'Product', 'RefId', 'TransactionId', 'Code'].includes(key) ? 'is-wide' : ''}><dt>{labels[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2')}</dt><dd>{display(key, value)}</dd></div>)}</dl>
      {fields.length === 0 && <p>Source details are unavailable for this record.</p>}
      <p className="gpay-detail-note">Details from your GPay export.{kind === 'activities' ? ' The activity ID is a source identifier, not a verified bank reference.' : kind === 'vouchers' ? ' Expiry does not confirm whether a voucher has been redeemed.' : ''}</p>
      {kind !== 'vouchers' && record && <div className="gpay-detail-bank-match"><strong>{record.bankMatch?.bank ? 'Linked bank transaction' : record.bankMatch?.status === 'Ambiguous' ? 'Multiple possible matches · Not linked' : record.bankMatch?.status || 'Not linked'}</strong>{record.bankMatch?.reason && <p className="gpay-detail-note">{record.bankMatch.reason}</p>}{record.bankMatch?.bank && <button type="button" className="btn btn--outline gpay-detail-review" onClick={() => onBank?.(record)}><FiLink /> View bank transaction</button>}
        {record.bankMatch?.status === 'Ambiguous' && record.bankMatch.candidates?.length > 0 && <ul className="gpay-detail-candidates" aria-label="Possible bank matches, none linked">{record.bankMatch.candidates.map(candidate => <li key={`${candidate.bank.accountId}|${candidate.bank.bankReference}|${candidate.bank.bankType}|${candidate.bank.transactionType}`}>
          <div className="gpay-detail-candidate-heading"><strong>{maskName(candidate.payee || 'Unnamed bank payee')}</strong><strong>{currencyFormatterFull.format(candidate.amount)}</strong></div>
          <p>{candidate.bank.bankType} · {display('Date', candidate.transactionDate)}<br /><span>{text(candidate.bank.bankReference)}</span></p>
          {candidate.valueDate && candidate.valueDate.slice(0, 10) !== candidate.transactionDate.slice(0, 10) && <p>Value date: {display('Date', candidate.valueDate)}</p>}
          {candidate.competingActivities > 0 && <p>Also fits {candidate.competingActivities} other GPay payment{candidate.competingActivities === 1 ? '' : 's'}.</p>}
          <button type="button" className="btn btn--outline" onClick={() => onBank?.(record, candidate)}>View possible bank transaction</button>
        </li>)}</ul>}
      </div>}
    </section>
  </Drawer>;
}
