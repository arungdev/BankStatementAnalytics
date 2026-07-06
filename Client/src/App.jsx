import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import api from "./api/client";
import { useAccount } from "./context/useAccount";
import { useAuth } from "./context/useAuth";
import CreateAccount from "./components/CreateAccount";
import Settings from "./pages/Settings";
import Sidebar from "./components/Sidebar";
import PageHeader from "./components/PageHeader";
import AccountFilter from "./components/AccountFilter";
import NotificationBell from "./components/NotificationBell";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import { InsightsFilters } from "./pages/Insights";
import { TrendsFilters } from "./pages/Trends";
import { TransactionsFilters } from "./pages/Transactions";

import Transactions from "./pages/Transactions";
import Merchants from "./pages/Merchants";
import UploadStatement from "./pages/UploadStatement";
import Trends from "./pages/Trends";
import Insights from "./pages/Insights";
import Bills from "./pages/Bills";
import useBillReminders from "./hooks/useBillReminders";

export default function App() {
  return (
    <BrowserRouter>
      <AuthGate />
    </BrowserRouter>
  );
}

function AuthGate() {
  const { loading, isAuthenticated, needsSetup } = useAuth();

  if (loading) return null;

  return (
    <Routes>
      <Route
        path="/setup"
        element={isAuthenticated ? <Navigate to="/" replace /> : <Setup />}
      />
      <Route
        path="/login"
        element={needsSetup ? <Navigate to="/setup" replace /> : (isAuthenticated ? <Navigate to="/" replace /> : <Login />)}
      />
      <Route element={needsSetup ? <Navigate to="/setup" replace /> : (isAuthenticated ? <Layout /> : <Navigate to="/login" replace />)}>
        <Route path="/" element={<Navigate to="/transactions" replace />} />
        <Route path="/trends" element={<Trends />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/merchants" element={<Merchants />} />
        <Route path="/upload" element={<UploadStatement />} />
        <Route path="/insights" element={<Insights />} />
        <Route path="/bills" element={<Bills />} />
      </Route>
    </Routes>
  );
}

const PAGE_META = {
  '/trends': { title: 'Trends', subtitle: 'Income vs. spends over time' },
  '/transactions': { title: 'Transactions' },
  '/merchants': { title: 'Merchants' },
  '/upload': { title: 'Upload Statement' },
  '/insights': { title: 'Spending Insights', subtitle: 'Where your money goes' },
  '/bills': { title: 'Bills & Reminders', subtitle: 'Upcoming recurring bills' },
};

function Layout() {
  const location = useLocation();
  const { selectedAccountId, setSelectedAccountId } = useAccount();

  // Fire desktop reminders for bills due soon (opt-in; see Settings → Reminders).
  useBillReminders();

  const [accounts, setAccounts] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [isSettingsOpen, setIsSettings] = useState(false);

  const fetchAccounts = () => {
    api.get('/statements/accounts')
      .then(res => setAccounts(res.data || []))
      .catch(() => { });
  };

  // ── Insights filter state (lifted so header row & page share it) ──────
  const [insightAccounts, setInsightAccounts] = useState([]);
  const [insightSelectedIds, setInsightSelectedIds] = useState([]);
  const [insightRange, setInsightRange] = useState({ start: null, end: null, preset: 'ALL', label: 'All Time' });
  const [insightGroupBy, setInsightGroupBy] = useState('byCategory');

  const toggleInsightAccount = (id) =>
    setInsightSelectedIds(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    );

  // ── Trends filter state (lifted so header row & page share it) ────────
  const [trendsPeriod, setTrendsPeriod] = useState('week');
  const [trendsRange, setTrendsRange] = useState({ start: null, end: null, preset: 'ALL', label: 'All Time' });

  // ── Transactions filter state (lifted so header row & page share it) ──
  const [transactionsRange, setTransactionsRange] = useState({ start: null, end: null, preset: 'ALL', label: 'All Time' });

  // Sidebar accounts
  useEffect(() => {
    api.get('/statements/accounts')
      .then(res => {
        setAccounts(res.data);
        if (res.data.length > 0 && !selectedAccountId)
          setSelectedAccountId(res.data[0].id);
      })
      .catch(() => setAccounts([]));
  }, [selectedAccountId, setSelectedAccountId]);

  // Insights accounts (load once when navigating to /insights)
  useEffect(() => {
    if (location.pathname !== '/insights') return;
    api.get('/statements/accounts')
      .then(res => {
        const list = res.data || [];
        setInsightAccounts(list);
        if (list.length > 0) setInsightSelectedIds(list.map(a => a.id));
      })
      .catch(() => { });
  }, [location.pathname]);

  const meta = PAGE_META[location.pathname] ?? { title: '' };
  const isInsights = location.pathname === '/insights';
  const isTrends = location.pathname === '/trends';
  const isTransactions = location.pathname === '/transactions';

  const filters = isInsights
    ? <InsightsFilters
      accounts={insightAccounts}
      selectedAccountIds={insightSelectedIds}
      toggleAccount={toggleInsightAccount}
      range={insightRange}
      setRange={setInsightRange}
      groupBy={insightGroupBy}
      setGroupBy={setInsightGroupBy}
    />
    : isTrends
      ? <>
        <AccountFilter accounts={accounts} value={selectedAccountId} onChange={setSelectedAccountId} />
        <TrendsFilters
          period={trendsPeriod}
          setPeriod={setTrendsPeriod}
          dateRange={trendsRange}
          setDateRange={setTrendsRange}
        />
      </>
      : isTransactions
        ? <>
          <AccountFilter accounts={accounts} value={selectedAccountId} onChange={setSelectedAccountId} />
          <TransactionsFilters
            dateRange={transactionsRange}
            setDateRange={setTransactionsRange}
          />
        </>
        : undefined;

  return (
    <div className="app">
      <Sidebar />

      <main className="main">
        <PageHeader
          title={meta.title}
          subtitle={meta.subtitle}
          filters={filters}
          actions={<NotificationBell />}
          onSettings={() => setIsSettings(true)}
        />

        {showCreate && (
          <div className="modal" onClick={() => setShowCreate(false)} style={{ zIndex: 20000 }}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <button className="modal-close" onClick={() => setShowCreate(false)}>&times;</button>
              <h3>Create Account</h3>
              <CreateAccount
                onClose={() => {
                  setShowCreate(false);
                }}
                onCreate={(data) => {
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
                    BankName: data.BankName,
                  }).then(res => {
                    setAccounts(prev => prev.map(a => a.id === temp.id ? res.data : a));
                    fetchAccounts();
                  }).catch(err => {
                    setAccounts(prev => prev.filter(a => a.id !== temp.id));
                    throw err;
                  });
                }}
              />
            </div>
          </div>
        )}

        <Settings
          isOpen={isSettingsOpen}
          onClose={() => setIsSettings(false)}
          onAddAccount={() => setShowCreate(true)}
          onAccountCreated={fetchAccounts}
          accounts={accounts}
          setAccounts={setAccounts}
        />
        <section className="content">
          <Outlet context={{
            insightAccounts,
            insightSelectedIds,
            insightRange,
            insightGroupBy,
            trendsPeriod,
            trendsRange,
            transactionsRange,
          }} />
        </section>
      </main>
    </div>
  );
}