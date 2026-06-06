import { useEffect, useState } from "react";
import api from "../api/client";

export default function Transactions() {
  const [tx, setTx] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/transactions")
      .then(res => {
        setTx(res.data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

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
        <div className="badge blue" style={{ padding: '8px 16px', fontSize: '14px' }}>
          {tx.length} Total
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
                <td>{new Date(t.transactionDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                <td style={{ fontWeight: 500 }}>{t.counterParty}</td>
                <td style={{ color: '#6b7280', fontSize: '14px' }}>{t.description || "-"}</td>
                <td className="text-red">{t.debit ? `₹${t.debit.toLocaleString('en-IN')}` : "-"}</td>
                <td className="text-green">{t.credit ? `₹${t.credit.toLocaleString('en-IN')}` : "-"}</td>
                <td><span className="badge">Completed</span></td>
              </tr>
            ))}
            {tx.length === 0 && (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', padding: '32px', color: '#6b7280' }}>
                  No transactions found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
