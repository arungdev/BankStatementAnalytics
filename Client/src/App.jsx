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
  FiSettings,
} from "react-icons/fi";

// Import pages
import Dashboard from "./pages/Dashboard";
import Transactions from "./pages/Transactions";
import Merchants from "./pages/Merchants";
import UploadStatement from "./pages/UploadStatement";
import Settings from "./pages/Settings";

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/merchants" element={<Merchants />} />
          <Route path="/upload-statement" element={<UploadStatement />} />
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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

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
      case "/":
        return "Dashboard";
      case "/transactions":
        return "Transactions";
      case "/merchants":
        return "Merchants";
      case "/upload-statement":
        return "Upload Statement";
      default:
        return "Bank Statement Analytics";
    }
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <FiTrendingUp size={22} />
          </div>
          Bank Statement Analytics
        </div>

        <nav className="nav">
          <Link to="/" className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}>
            <FiHome /> Dashboard
          </Link>

          <Link to="/transactions" className={`nav-link ${location.pathname === '/transactions' ? 'active' : ''}`}>
            <FiList /> Transactions
          </Link>

          <Link to="/merchants" className={`nav-link ${location.pathname === '/merchants' ? 'active' : ''}`}>
            <FiUsers /> Merchants
          </Link>

          <Link to="/upload-statement" className={`nav-link ${location.pathname === '/upload-statement' ? 'active' : ''}`}>
            <FiCreditCard /> Upload Statement
          </Link>
        </nav>

        <div className="accounts">
          <p className="section-title">Selected Account</p>
          {accounts.length === 0 ? (
            <div className="account-item">No accounts found</div>
          ) : (
            <select 
              className="account-select"
              value={selectedAccountId || ''}
              onChange={(e) => setSelectedAccountId(Number(e.target.value))}
            >
              <option value="">Select an account...</option>
              {accounts.map(acc => (
                <option key={acc.id} value={acc.id}>
                  {acc.maskedAccountNumber || acc.accountNumber || '****'} ({acc.bankName})
                </option>
              ))}
            </select>
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
            
            <button 
              onClick={() => setIsSettingsOpen(true)}
              style={{ 
                cursor: 'pointer', 
                background: '#f3f4f6', 
                border: '1px solid #d1d5db', 
                borderRadius: '50%', 
                width: '38px', 
                height: '38px', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                color: '#374151',
                transition: 'background-color 0.2s',
                margin: '0 12px'
              }}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#e5e7eb'}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
              title="Settings"
            >
              <FiSettings size={18} />
            </button>

            <div className="avatar">AG</div>
          </div>
        </header>
        
        <Settings isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

        <section className="content">
          {children}
        </section>
      </main>
    </div>
  );
}
