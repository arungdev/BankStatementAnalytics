import { useEffect, useRef, useState } from 'react';
import { Avatar, Drawer } from '@common/client';
import { FiArrowLeft, FiLink } from 'react-icons/fi';
import { currencyFormatterFull, maskName } from '../utils/format';
import { usePrivacy } from '../context/usePrivacy';
import './GPayActivityDrawer.css';

const titles = { activities: 'Payment details', orders: 'Order details', rewards: 'Cashback details', vouchers: 'Voucher details' };
const labels = { CounterPartyName: 'Recipient / sender', AccountSuffix: 'Account', RefId: 'GPay activity ID', TransactionId: 'Order transaction ID', PaymentMethod: 'Payment method', ExpiryTimestamp: 'Expires', Timestamp: 'Date and time', Time: 'Date and time', Date: 'Date', Type: 'Payment type' };
const dateFields = new Set(['Timestamp', 'Time', 'Date', 'ExpiryTimestamp']);

export default function GPayActivityDrawer({ selection, onClose, onReview, busy, width = 450, onWidthChange }) {
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
        {source.Amount !== undefined && source.Amount !== null && <strong className={`gpay-detail-amount ${direction ? `is-${direction}` : ''}`}>{direction === 'credit' ? '+' : direction === 'debit' ? '−' : ''}{currencyFormatterFull.format(source.Amount)}</strong>}
        {source.Status && <span>{source.Status}</span>}
      </div>
      <dl className="gpay-detail-fields">{fields.map(([key, value]) => <div key={key} className={['Description', 'Summary', 'Details', 'Product', 'RefId', 'TransactionId', 'Code'].includes(key) ? 'is-wide' : ''}><dt>{labels[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2')}</dt><dd>{display(key, value)}</dd></div>)}</dl>
      {fields.length === 0 && <p>Source details are unavailable for this record.</p>}
      <p className="gpay-detail-note">Details from your GPay export.{kind === 'activities' ? ' The activity ID is a source identifier, not a verified bank reference.' : kind === 'vouchers' ? ' Expiry does not confirm whether a voucher has been redeemed.' : ''}</p>
      {kind !== 'vouchers' && record && <button type="button" className="btn btn--outline gpay-detail-review" disabled={busy} onClick={() => onReview({ recordId: record.id, title: source.Description || source.Type || name })}><FiLink /> Review bank match</button>}
    </section>
  </Drawer>;
}
