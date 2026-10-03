import { useEffect, useRef, useState } from 'react';
import { Drawer } from '@common/client';
import { FiArrowLeft, FiArrowDownLeft, FiArrowUpRight, FiLink, FiRefreshCw } from 'react-icons/fi';
import api from '../api/client';
import { currencyFormatterFull, formatDate, maskName } from '../utils/format';
import { findLinkedTransaction } from '../utils/linkedTransaction';
import { usePrivacy } from '../context/usePrivacy';

export default function LinkedTransactionDrawer({ link, onClose }) {
  const { maskAmounts } = usePrivacy();
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [width, setWidth] = useState(() => Math.min(480, window.innerWidth));
  const backRef = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    const resize = () => setWidth(Math.min(480, window.innerWidth));
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    if (!link) return;
    const controller = new AbortController();
    // The existing endpoint enforces account ownership and returns statement rows.
    // Match the full stored key, never just the displayed reference or amount.
    api.get('/transactions', { params: { accountId: link.accountId }, signal: controller.signal })
      .then(({ data }) => {
        const transaction = findLinkedTransaction(data || [], link);
        if (!controller.signal.aborted) setResult({ link, attempt, transaction });
      })
      .catch(error => {
        if (!controller.signal.aborted) setResult({ link, attempt, error: error.response?.status === 404
          ? 'The linked account or transaction is no longer available.'
          : error.response ? 'Could not load the transaction. Please retry.' : error.message });
      });
    return () => controller.abort();
  }, [link, attempt]);

  useEffect(() => {
    if (!link) return;
    backRef.current?.focus();
    const onKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [link]);

  const current = result?.link === link && result?.attempt === attempt ? result : null;
  const tx = current?.transaction;
  const field = (label, value) => <div><dt>{label}</dt><dd>{value || '—'}</dd></div>;
  const privateText = value => maskAmounts ? 'Hidden in privacy mode' : value;

  return <Drawer open={!!link} onClose={onClose} title="Linked transaction" width={width}>
    <section className="linked-tx-panel" aria-label="Linked bank transaction">
      <button ref={backRef} className="linked-tx-back" onClick={onClose}><FiArrowLeft /> Back to expense</button>
      <div className="linked-tx-context"><FiLink /><div><strong>{maskName(link?.participantName || 'Bank payment')}</strong><span>{maskName(link?.expenseTitle)}</span></div></div>
      {!current && <p role="status" className="linked-tx-message">Loading bank transaction…</p>}
      {current?.error && <div className="linked-tx-message" role="alert"><p>{current.error}</p><button className="btn btn--outline" onClick={() => setAttempt(value => value + 1)}><FiRefreshCw /> Retry</button></div>}
      {tx && <>
        <div className={`linked-tx-hero ${tx.credit > 0 ? 'is-credit' : 'is-debit'}`}>
          <span className="linked-tx-direction">{tx.credit > 0 ? <FiArrowDownLeft /> : <FiArrowUpRight />}{tx.credit > 0 ? 'Money received' : 'Money paid'}</span>
          <strong>{currencyFormatterFull.format(tx.credit > 0 ? tx.credit : tx.debit)}</strong>
          <span>{maskName(tx.merchant) || 'Bank transaction'} · {formatDate(tx.transactionDate)}</span>
        </div>
        <dl className="linked-tx-fields">
          {field('Account', `${tx.bankType} · Account ${tx.accountId}`)}
          {field('Transaction date', formatDate(tx.transactionDate))}
          {field('Bank reference', privateText(tx.bankReference))}
          {field('UPI reference', privateText(tx.upiReference))}
          {field('Payment mode', tx.mode)}
          {field('Account balance', currencyFormatterFull.format(tx.balance))}
          {field('Category', tx.category || 'Uncategorized')}
          {field('Subcategory', tx.subCategory)}
        </dl>
        <div className="linked-tx-description"><h3>Statement description</h3><p>{privateText(tx.description) || 'No description recorded.'}</p></div>
        {tx.note && <div className="linked-tx-description"><h3>Note</h3><p>{privateText(tx.note)}</p></div>}
        <p className="linked-tx-footnote">Details from your imported bank statement.</p>
      </>}
    </section>
  </Drawer>;
}
