import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import api from "./api/client";
import { useAccount } from "./context/useAccount";
import CreateAccount from "./components/CreateAccount";
import {
  FiSearch,
  FiPlus,
  FiSettings,
} from "react-icons/fi";

// Import pages
import Dashboard from "./pages/Dashboard";
import Transactions from "./pages/Transactions";
import Merchants from "./pages/Merchants";
import UploadStatement from "./pages/UploadStatement";
import Trends from "./pages/Trends";
import Settings from "./pages/Settings";
import Sidebar from "./components/Sidebar";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/trends" element={<Trends />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/merchants" element={<Merchants />} />
          <Route path="/upload" element={<UploadStatement />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

function Layout() {
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
      case "/dashboard":
        return "Dashboard";
      case "/trends":
        return "Trends";
      case "/transactions":
        return "Transactions";
      case "/merchants":
        return "Merchants";
      case "/upload":
        return "Upload Statement";
      default:
        return "Dashboard";
    }
  };

  return (
    <div className="app">
      <Sidebar 
        accounts={accounts}
        selectedAccountId={selectedAccountId}
        onAccountChange={setSelectedAccountId}
        onAddAccount={() => setShowCreate(true)}
      />

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
        
        {showCreate && (
          <div className="modal" onClick={() => setShowCreate(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <button className="modal-close" onClick={() => setShowCreate(false)}>&times;</button>
              <h3>Create Account</h3>
              <CreateAccount onClose={() => setShowCreate(false)} onCreate={(data) => {
                const temp = {
                  id: `temp-${Date.now()}`,
                  accountHolderName: data.AccountHolderName,
                  accountNumber: data.AccountNumber,
                  maskedAccountNumber: '****' + (data.AccountNumber?.slice(-4) || ''),
                  bankName: data.BankName,
                };
                setAccounts(prev => [temp, ...prev]);

                return api.post('/accounts', {
                  AccountHolderName: data.AccountHolderName,
                  AccountNumber: data.AccountNumber,
                  BankName: data.BankName
                }).then(res => {
                  setAccounts(prev => prev.map(a => a.id === temp.id ? res.data : a));
                }).catch(err => {
                  setAccounts(prev => prev.filter(a => a.id !== temp.id));
                  throw err;
                });
              }} />
            </div>
          </div>
        )}

        <Settings isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

        <section className="content">
          <Outlet />
        </section>
      </main>
    </div>
  );
}
