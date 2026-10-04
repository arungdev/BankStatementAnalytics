import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiArrowRight, FiUsers } from 'react-icons/fi';
import { getTransactionBillSplits } from '../api/splits';
import { currencyFormatter as fmt, maskName } from '../utils/format';
import { usePrivacy } from '../context/usePrivacy';
import './SharedBills.css';

export default function TransactionBillSplits({ transaction }) {
  usePrivacy();
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const requestKey = JSON.stringify({ accountId: transaction.accountId,
    bankReference: transaction.bankReference || transaction.id, bankType: transaction.bankType,
    transactionType: transaction.transactionType, attempt });
  useEffect(() => {
    const controller = new AbortController();
    const params = JSON.parse(requestKey);
    delete params.attempt;
    if (!params.transactionType) return;
    getTransactionBillSplits(params, controller.signal)
      .then(res => { if (!controller.signal.aborted) setResult({ key: requestKey, data: res.data }); })
      .catch(() => { if (!controller.signal.aborted) setResult({ key: requestKey, error: true }); });
    return () => controller.abort();
  }, [requestKey]);
  const current = result?.key === requestKey ? result : null;
  if (!transaction.transactionType || current?.data?.length === 0) return null;
  return <section className="transaction-bill-splits" aria-label="Linked shared bills">
    <h3><FiUsers aria-hidden="true" />Linked shared bills</h3>
    {!current && <p role="status">Checking bill links…</p>}
    {current?.error && <p role="alert">Could not load bill links. <button className="shared-bills-link" onClick={() => setAttempt(value => value + 1)}>Retry</button></p>}
    {current?.data?.map((bill, index) => <Link key={`${bill.splitId}-${index}`} className="shared-bill-context" to={`/splits?splitId=${bill.splitId}`}>
      <span className="shared-bill-context-heading"><strong>{maskName(bill.title)}</strong><FiArrowRight aria-hidden="true" /></span>
      <small>{bill.role}{bill.participantName ? ` · ${maskName(bill.participantName)}` : ''}{bill.groupName ? ` · ${maskName(bill.groupName)}` : ''}</small>
      <span>My share: {fmt.format(bill.myShare)} · {bill.pendingAmount > 0 ? `${bill.isCreatedByUser ? 'To collect' : 'You owe'}: ${fmt.format(bill.pendingAmount)}` : 'No outstanding balance'}</span>
      {bill.allocatedAmount != null && <span>Allocated from this transaction: {fmt.format(bill.allocatedAmount)}</span>}
      {bill.settlementEvidence && <small>{bill.settlementEvidence}</small>}
      <span className="shared-bills-link">Open expense</span>
    </Link>)}
  </section>;
}
