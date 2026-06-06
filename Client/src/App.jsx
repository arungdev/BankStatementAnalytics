import { BrowserRouter, Routes, Route, Link, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import api from "./api/client";
import { useAccount } from "./context/useAccount";
import CreateAccount from "./components/CreateAccount";
import {
  FiHome,
  FiList,
  FiUsers,
  FiCreditCard,
  FiSearch,
  FiPlus,
  FiTrendingUp,
} from "react-icons/fi";

// Import pages
import Dashboard from "./pages/Dashboard";
import Transactions from "./pages/Transactions";
import Counterparties from "./pages/Counterparties";

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/counterparties" element={<Counterparties />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

function Layout({ children }) {
  const location = useLocation();
  const { selectedAccountId, setSelectedAccountId } = useAccount();
  const [accounts, setAccounts] = useState([]);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    api.get('/statements/accounts')
      .then(res => {
        setAccounts(res.data);
        // Auto-select first account if not yet selected
        if (res.data.length > 0 && !selectedAccountId) {
          setSelectedAccountId(res.data[0].id);
        }
      })
      .catch(() => setAccounts([]));
  }, [selectedAccountId, setSelectedAccountId]);

  const getPageTitle = (pathname) => {
    switch (pathname) {
      case "/": return "Dashboard";
      case "/transactions": return "Transactions";
      case "/counterparties": return "Counterparties";
      default: return "FinTrack";
    }
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <FiTrendingUp size={22} />
          </div>
          FinTrack
        </div>

        <nav className="nav">
          <Link to="/" className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}>
            <FiHome /> Dashboard
          </Link>

          <Link to="/transactions" className={`nav-link ${location.pathname === '/transactions' ? 'active' : ''}`}>
            <FiList /> Transactions
          </Link>

          <Link to="/counterparties" className={`nav-link ${location.pathname === '/counterparties' ? 'active' : ''}`}>
            <FiUsers /> Counterparties
          </Link>
        </nav>

        <div className="accounts">
          <p className="section-title">Your Accounts</p>
          {accounts.length === 0 ? (
            <div className="account-item">No accounts found</div>
          ) : (
            accounts.map(acc => (
              <div 
                key={acc.id} 
                className={`account-item ${selectedAccountId === acc.id ? 'active' : ''}`}
                onClick={() => setSelectedAccountId(acc.id)}
              >
                <FiCreditCard size={18} color={acc.bankName === 'IOB' ? '#4f46e5' : '#10b981'} />
                <span>{acc.maskedAccountNumber || acc.accountNumber || '****'}</span>
              </div>
            ))
          )}
        </div>

        <button className="addBtn" aria-label="Add Account" onClick={() => setShowCreate(true)}>
          <FiPlus size={18} /> Add Account
        </button>

        {showCreate && (
          <div className="modal" onClick={() => setShowCreate(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <h3>Create Account</h3>
              <CreateAccount onClose={() => setShowCreate(false)} onCreate={(data) => {
                // optimistic UI: create temporary account locally
                const temp = {
                  id: `temp-${Date.now()}`,
                  accountHolderName: data.AccountHolderName,
                  accountNumber: data.AccountNumber,
                  maskedAccountNumber: '****' + (data.AccountNumber?.slice(-4) || ''),
                  bankName: data.BankName,
                };
                setAccounts(prev => [temp, ...prev]);

                // send to server and replace temp when done
                return api.post('/accounts', {
                  AccountHolderName: data.AccountHolderName,
                  AccountNumber: data.AccountNumber,
                  BankName: data.BankName
                }).then(res => {
                  // replace temp by real account from response
                  setAccounts(prev => prev.map(a => a.id === temp.id ? res.data : a));
                }).catch(err => {
                  // remove temp on failure
                  setAccounts(prev => prev.filter(a => a.id !== temp.id));
                  throw err;
                });
              }} />
            </div>
          </div>
        )}
      </aside>

      <main className="main">
        <header className="topbar">
          <h2>{getPageTitle(location.pathname)}</h2>

          <div className="topbar-right">
            <div className="search">
              <FiSearch />
              <input placeholder="Search transactions, accounts..." />
            </div>
            <div className="avatar">AG</div>
          </div>
        </header>

        <section className="content">
          {children}
        </section>
      </main>
    </div>
  );
}
