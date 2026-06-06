import { useEffect, useState } from "react";
import api from "../api/client";
import { FiDollarSign, FiArrowDownRight, FiArrowUpRight, FiActivity } from "react-icons/fi";

export default function Dashboard() {
  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get("/statements/accounts"),
      api.get("/transactions")
    ])
      .then(([accRes, txRes]) => {
        setAccounts(accRes.data);
        setTransactions(txRes.data);
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
        <div className="loader-text">Loading your dashboard...</div>
      </div>
    );
  }

  // stats calculation
  const totalBalance = accounts.reduce((s, a) => s + a.balance, 0);
  const totalDebit = transactions.reduce((s, t) => s + (t.debit || 0), 0);
  const totalCredit = transactions.reduce((s, t) => s + (t.credit || 0), 0);
  const netFlow = totalCredit - totalDebit;

  return (
    <div>
      <h1>Overview</h1>

      {/* STATS CARDS */}
      <div className="grid">
        <div className="card">
          <div className="card-icon blue">
            <FiDollarSign />
          </div>
          <p>Total Balance</p>
          <h2>₹{totalBalance.toLocaleString('en-IN')}</h2>
        </div>
        <div className="card">
          <div className="card-icon red">
            <FiArrowDownRight />
          </div>
          <p>Total Debit</p>
          <h2>₹{totalDebit.toLocaleString('en-IN')}</h2>
        </div>
        <div className="card">
          <div className="card-icon green">
            <FiArrowUpRight />
          </div>
          <p>Total Credit</p>
          <h2>₹{totalCredit.toLocaleString('en-IN')}</h2>
        </div>
        <div className="card">
          <div className="card-icon purple">
            <FiActivity />
          </div>
          <p>Net Flow</p>
          <h2 className={netFlow >= 0 ? "text-green" : "text-red"}>
            ₹{netFlow.toLocaleString('en-IN')}
          </h2>
        </div>
      </div>

      {/* ACCOUNTS */}
      <h2 className="section-heading">Active Accounts</h2>
      <div className="grid">
        {accounts.map(acc => (
          <div key={acc.id} className="card" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p style={{ fontWeight: 600, color: '#374151' }}>{acc.bankName}</p>
                <p style={{ fontSize: '13px', marginTop: '4px' }}>Account ending in {acc.accountNumber?.slice(-4) || '****'}</p>
              </div>
              <div className="badge blue">Active</div>
            </div>
            <h2 style={{ fontSize: '24px', marginTop: '16px' }}>₹{acc.balance.toLocaleString('en-IN')}</h2>
          </div>
        ))}
      </div>

      {/* RECENT TRANSACTIONS */}
      <h2 className="section-heading">Recent Transactions</h2>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Counterparty</th>
              <th>Debit</th>
              <th>Credit</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {transactions.slice(0, 10).map(tx => (
              <tr key={tx.id}>
                <td>{new Date(tx.transactionDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                <td style={{ fontWeight: 500 }}>{tx.counterParty}</td>
                <td className="text-red">{tx.debit ? `₹${tx.debit.toLocaleString('en-IN')}` : "-"}</td>
                <td className="text-green">{tx.credit ? `₹${tx.credit.toLocaleString('en-IN')}` : "-"}</td>
                <td><span className="badge">Completed</span></td>
              </tr>
            ))}
            {transactions.length === 0 && (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', padding: '32px', color: '#6b7280' }}>
                  No recent transactions found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
