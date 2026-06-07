import { useState, useEffect } from 'react';
import { useAccount } from '../context/useAccount';
import api from '../api/client';
import StatCard from '../components/StatCard';
import './Dashboard.css';

const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
});

const formatDate = (dateString) => {
  const date = new Date(dateString);
  // This format will produce "03 Jun 2026"
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric', // Using 'numeric' for full year to avoid ambiguity
  });
};

const Dashboard = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { selectedAccountId } = useAccount();

  useEffect(() => {
    if (!selectedAccountId) {
        setLoading(false);
        setData(null);
        return;
    }
    setLoading(true);
    api.get(`/dashboard?accountId=${selectedAccountId}`)
        .then(res => {
            setData(res.data);
        })
        .catch(err => {
            console.error("Failed to fetch dashboard data:", err);
            setData(null);
        })
        .finally(() => {
            setLoading(false);
        });
  }, [selectedAccountId]);

  if (loading) {
    return <div className="dashboard-loader">Loading dashboard data...</div>;
  }

  if (!data) {
    return <div className="dashboard-empty">No data available. Select an account to see the overview.</div>;
  }
  
  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <h1>Dashboard Overview</h1>
        {/* The header from the screenshot could be a separate component above this */}
      </header>

      <div className="stats-grid">
        <StatCard title="Total Income" value={currencyFormatter.format(data.totalIncome)} />
        <StatCard title="Total Spends" value={currencyFormatter.format(data.totalSpends)} />
        <StatCard title="Total Transactions" value={data.totalTransactions} />
      </div>

      <div className="content-grid">
        <div className="card">
          <h2 className="card-title">Top Spending Merchants</h2>
          <ul className="list">
            {(data.topMerchants || []).map((merchant, index) => (
              <li key={index} className="list-item">
                <span>{merchant.name}</span>
                <span className="list-item-value">{currencyFormatter.format(merchant.amount)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <h2 className="card-title">Recent Transactions</h2>
          <ul className="list">
            {(data.recentTransactions || []).map((tx) => (
              <li key={tx.id} className="list-item transaction-item">
                <div className="transaction-details">
                  <span className="transaction-name">{tx.name}</span>
                  <span className="transaction-meta">
                    {formatDate(tx.date)} &bull; {tx.mode}
                  </span>
                </div>
                <span className={`transaction-amount ${tx.amount < 0 ? 'spend' : 'income'}`}>
                  {currencyFormatter.format(tx.amount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;