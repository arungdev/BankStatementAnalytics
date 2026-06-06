import { useEffect, useState } from "react";
import api from "../api/client";
import { useAccount } from "../context/useAccount";

export default function Transactions() {
  const { selectedAccountId } = useAccount();
  const [tx, setTx] = useState([]);
  const [loading, setLoading] = useState(!selectedAccountId);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!selectedAccountId) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    api.get(`/transactions?accountId=${selectedAccountId}`)
      .then(res => {
        setTx(res.data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, [selectedAccountId]);

  if (loading) {
    return (
      <div className="loader-container">
        <div className="spinner"></div>
        <div className="loader-text">Loading transactions...</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <h1 style={{ marginBottom: 0 }}>All Transactions</h1>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div className="badge blue" style={{ padding: '10px 18px', fontSize: '13px', fontWeight: 700 }}>
            {tx.length} Total Transactions
          </div>
        </div>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Counterparty</th>
              <th>Description</th>
              <th>Debit</th>
              <th>Credit</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {tx.map(t => (
              <tr key={t.id}>
                <td style={{ fontWeight: 600 }}>{new Date(t.transactionDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                <td style={{ fontWeight: 600 }}>{t.counterParty}</td>
                <td style={{ color: '#6b7280', fontSize: '13px' }}>{t.description || "-"}</td>
                <td className="text-red">{t.debit ? `₹${t.debit.toLocaleString('en-IN')}` : "-"}</td>
                <td className="text-green">{t.credit ? `₹${t.credit.toLocaleString('en-IN')}` : "-"}</td>
                <td><span className="badge green">Completed</span></td>
              </tr>
            ))}
            {tx.length === 0 && (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', padding: '48px 24px', color: '#9ca3af', fontStyle: 'italic' }}>
                  No transactions found for the selected account.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
