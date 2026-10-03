import { useState } from 'react';
import { Avatar } from '@common/client';
import Pagination from './Pagination';
import { currencyFormatter, maskName } from '../utils/format';
import './GPayActivityTable.css';

const unpack = record => {
  try { return JSON.parse(record.source.data); } catch { return {}; }
};
const timestamp = value => {
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : 0;
};
const dateParts = value => {
  if (!value || !timestamp(value)) return ['—', ''];
  const date = new Date(value);
  const options = { timeZone: 'Asia/Kolkata' };
  return [date.toLocaleDateString('en-GB', { ...options, day: '2-digit' }), date.toLocaleDateString('en-GB', { ...options, month: 'short', year: '2-digit' })];
};

export default function GPayActivityTable({ records, kind, busy, onReview, onSelect, selectedId, page, onPageChange }) {
  const [pageSize, setPageSize] = useState(20);
  const [loadedAt] = useState(() => Date.now());
  const [sort, setSort] = useState({ field: 'date', direction: 'desc' });
  const vouchers = kind === 'vouchers';
  const rows = records.map(record => {
    const data = unpack(record);
    return { record, data, name: data.CounterPartyName || data.Description || data.Summary || data.Type || 'Unnamed payment', date: data.Timestamp || data.Time || data.Date || data.ExpiryTimestamp };
  }).sort((a, b) => {
    const comparison = sort.field === 'name' ? a.name.localeCompare(b.name) : sort.field === 'amount' ? (a.data.Amount || 0) - (b.data.Amount || 0) : timestamp(a.date) - timestamp(b.date);
    return (sort.direction === 'asc' ? comparison : -comparison) || a.record.id - b.record.id;
  });
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page + 1, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const visible = rows.slice(startIndex, startIndex + pageSize);
  const changeSort = field => { setSort(previous => ({ field, direction: previous.field === field && previous.direction === 'desc' ? 'asc' : 'desc' })); onPageChange(0); };
  const header = (field, label) => <th scope="col" aria-sort={sort.field === field ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}><button type="button" onClick={() => changeSort(field)}>{label}<span aria-hidden="true">{sort.field === field ? sort.direction === 'asc' ? '▴' : '▾' : '↕'}</span></button></th>;
  return <div className="gpay-activity-list">
    <div className="gpay-activity-scroll" tabIndex={0} aria-label="GPay records table, scroll for more rows">
      <table className="gpay-activity-table">
        <thead><tr>{header('date', vouchers ? 'Expires' : 'Date')}{header('name', 'Description')}<th scope="col">Status / method</th><th scope="col">Action</th>{vouchers ? <th scope="col">Voucher code</th> : header('amount', 'Amount')}</tr></thead>
        <tbody>{visible.map(row => {
          const { record, data, name } = row;
          const [day, month] = dateParts(row.date);
          const state = vouchers ? (!row.date || !timestamp(row.date) ? 'Expiry unknown' : timestamp(row.date) > loadedAt ? 'Not expired' : 'Expired') : data.Status || 'Earned';
          // Direction comes only from explicit source facts, never the merchant name.
          const direction = kind === 'rewards' || data.Type === 'Received' ? 'credit' : ['Paid', 'Sent'].includes(data.Type) ? 'debit' : '';
          return <tr key={record.id} className={selectedId === record.id ? 'is-selected' : ''} onClick={event => onSelect?.(record, event.currentTarget)}>
            <td className="gpay-activity-date"><strong>{day}</strong><small>{month}</small></td>
            <td><div className="gpay-activity-merchant"><Avatar name={maskName(name) || '?'} size={36} /><div><button type="button" className="gpay-activity-detail-link" aria-label={`View details: ${maskName(name)}`} aria-expanded={selectedId === record.id} title={maskName(name)}>{maskName(name)}</button><div className="gpay-activity-meta">{data.AccountSuffix && <span className="gpay-activity-account">Account ••••{data.AccountSuffix}</span>}<span title={maskName(data.RefId || data.TransactionId || data.Details)}>{maskName(data.RefId || data.TransactionId || data.Details)}</span></div></div></div></td>
            <td><span className={`gpay-activity-status ${state === 'Completed' || state === 'Complete' || state === 'Earned' ? 'is-complete' : state === 'Failed' ? 'is-failed' : ''}`}>{state}</span>{data.PaymentMethod && <small>{maskName(data.PaymentMethod)}</small>}</td>
            <td>{!vouchers && <button type="button" className="btn btn--outline" disabled={busy} onClick={event => { event.stopPropagation(); onReview({ recordId: record.id, title: data.Description || data.Type || name }); }}>Review bank match</button>}</td>
            <td className={`gpay-activity-amount ${direction ? `is-${direction}` : ''}`}>{vouchers ? maskName(data.Code) : <>{direction === 'credit' ? '+' : direction === 'debit' ? '−' : ''}{currencyFormatter.format(data.Amount ?? 0)}</>}</td>
          </tr>;
        })}{rows.length === 0 && <tr><td colSpan={5} className="gpay-activity-empty">No matching records. Try another search or view.</td></tr>}</tbody>
      </table>
    </div>
    <Pagination currentPage={currentPage} totalPages={totalPages} itemsPerPage={pageSize} currentCount={visible.length} totalCount={rows.length} startIndex={startIndex} itemLabel="records" onPageChange={value => onPageChange(value - 1)} onItemsPerPageChange={value => { setPageSize(value); onPageChange(0); }} />
  </div>;
}
