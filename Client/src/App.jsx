import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import api from "./api/client";
import { useAccount } from "./context/useAccount";
import { useAuth } from "./context/useAuth";
import { usePrivacy } from "./context/usePrivacy";
import CreateAccount from "./components/CreateAccount";
import Modal from "./components/ui/Modal";
import Settings from "./pages/Settings";
import Sidebar from "./components/Sidebar";
import PageHeader from "./components/PageHeader";
import AccountFilter, { ALL_ACCOUNTS } from "./components/AccountFilter";
import NotificationBell from "./components/NotificationBell";
import PrivacyToggle from "./components/PrivacyToggle";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import { InsightsFilters } from "./pages/Insights";
import { ReportsFilters } from "./pages/Reports";
import { TrendsFilters } from "./pages/Trends";
import { TransactionsFilters } from "./pages/Transactions";

import Overview from "./pages/Overview";
import Transactions from "./pages/Transactions";
import Merchants from "./pages/Merchants";
import UploadStatement from "./pages/UploadStatement";
import Trends from "./pages/Trends";
import Insights from "./pages/Insights";
import Bills from "./pages/Bills";
import Budgets from "./pages/Budgets";
import Investments from "./pages/Investments";
import Reports from "./pages/Reports";
import useBillReminders from "./hooks/useBillReminders";
import usePersistedState from "./hooks/usePersistedState";
import usePersistedRange from "./hooks/usePersistedRange";

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
        element={needsSetup ? <Setup /> : (isAuthenticated ? <Navigate to="/" replace /> : <Setup />)}
      />
      <Route
        path="/login"
        element={needsSetup ? <Navigate to="/setup" replace /> : (isAuthenticated ? <Navigate to="/" replace /> : <Login />)}
      />
      <Route element={needsSetup ? <Navigate to="/setup" replace /> : (isAuthenticated ? <Layout /> : <Navigate to="/login" replace />)}>
        <Route path="/" element={<Overview />} />
        <Route path="/trends" element={<Trends />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/merchants" element={<Merchants />} />
        <Route path="/upload" element={<UploadStatement />} />
        <Route path="/insights" element={<Insights />} />
        <Route path="/bills" element={<Bills />} />
        <Route path="/budgets" element={<Budgets />} />
        <Route path="/investments" element={<Investments />} />
        <Route path="/reports" element={<Reports />} />
      </Route>
    </Routes>
  );
}

const PAGE_META = {
  '/': { title: 'Overview', subtitle: 'Your account at a glance' },
  '/trends': { title: 'Trends', subtitle: 'Income vs. spends over time' },
  '/transactions': { title: 'Transactions' },
  '/merchants': { title: 'Merchants', subtitle: 'Who you transact with, and how they’re categorized' },
  '/upload': { title: 'Upload Statement' },
  '/insights': { title: 'Spending Insights', subtitle: 'Where your money goes' },
  '/bills': { title: 'Bills & Reminders', subtitle: 'Upcoming recurring bills' },
  '/budgets': { title: 'Budgets', subtitle: 'Monthly limits by category' },
  '/investments': { title: 'Investments', subtitle: 'Recurring & fixed deposits' },
  '/reports': { title: 'Reports', subtitle: 'Monthly & yearly summary' },
};

function Layout() {
  const location = useLocation();
  const { selectedAccountId, setSelectedAccountId } = useAccount();
  // Consuming the privacy flag here re-renders Layout (and, via the fresh
  // outlet context object, every page that reads useOutletContext) on toggle.
  // Pages that read no outlet context (Bills/Budgets/Investments/Merchants)
  // don't re-render from this alone — React Router bails out on the cached
  // outlet element — so those pages call usePrivacy() themselves.
  const { maskAmounts, setMaskAmounts } = usePrivacy();

  // Fire desktop reminders for bills due soon (opt-in; see Settings → Reminders).
  useBillReminders();

  const [accounts, setAccounts] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [isSettingsOpen, setIsSettings] = useState(false);
  // Width occupied by the docked Reminders drawer (0 when closed) so the
  // page content shifts beside it, like the per-page RHS detail drawers.
  const [remindersDock, setRemindersDock] = useState(0);

  const fetchAccounts = () => {
    api.get('/statements/accounts')
      .then(res => setAccounts(res.data || []))
      .catch(() => { });
  };

  // ── Insights filter state (lifted so header row & page share it) ──────
  // Insights now uses the globally selected account (same as Trends), so it
  // only lifts its own date range and group-by here.
  const [insightRange, setInsightRange] = usePersistedRange('insightRange');
  const [insightGroupBy, setInsightGroupBy] = usePersistedState('insightGroupBy', 'byCategory');

  // ── Trends filter state (lifted so header row & page share it) ────────
  const [trendsPeriod, setTrendsPeriod] = usePersistedState('trendsPeriod', 'week');
  const [trendsRange, setTrendsRange] = usePersistedRange('trendsRange');

  // ── Transactions filter state (lifted so header row & page share it) ──
  const [transactionsRange, setTransactionsRange] = usePersistedRange('transactionsRange');

  // ── Reports filter state (lifted so header row & page share it) ───────
  const [reportType, setReportType] = usePersistedState('reportType', 'month');
  const [reportPeriod, setReportPeriod] = usePersistedState('reportPeriod', '');

  // Sidebar accounts
  useEffect(() => {
    api.get('/statements/accounts')
      .then(res => {
        setAccounts(res.data);
        if (res.data.length > 0) {
          // "All accounts" is a valid selection even though no account has that id.
          const stillExists = selectedAccountId === ALL_ACCOUNTS
            || res.data.some(a => a.id === selectedAccountId);
          if (!selectedAccountId || !stillExists)
            setSelectedAccountId(res.data[0].id);
        }
      })
      .catch(() => setAccounts([]));
  }, [selectedAccountId, setSelectedAccountId]);

  const meta = PAGE_META[location.pathname] ?? { title: '' };
  const isOverview = location.pathname === '/';
  const isInsights = location.pathname === '/insights';
  const isTrends = location.pathname === '/trends';
  const isTransactions = location.pathname === '/transactions';
  const isReports = location.pathname === '/reports';
  const isMerchants = location.pathname === '/merchants';

  // Opens the Create Account modal directly, skipping the Settings detour.
  const goAddAccount = () => setShowCreate(true);

  const filters = isOverview
    ? <AccountFilter accounts={accounts} value={selectedAccountId} onChange={setSelectedAccountId} onAdd={goAddAccount} />
    : isInsights
    ? <>
      <AccountFilter accounts={accounts} value={selectedAccountId} onChange={setSelectedAccountId} onAdd={goAddAccount} />
      <InsightsFilters
        range={insightRange}
        setRange={setInsightRange}
        groupBy={insightGroupBy}
        setGroupBy={setInsightGroupBy}
      />
    </>
    : isTrends
      ? <>
        <AccountFilter accounts={accounts} value={selectedAccountId} onChange={setSelectedAccountId} onAdd={goAddAccount} />
        <TrendsFilters
          period={trendsPeriod}
          setPeriod={setTrendsPeriod}
          dateRange={trendsRange}
          setDateRange={setTrendsRange}
        />
      </>
      : isTransactions
        ? <>
          <AccountFilter
            accounts={accounts}
            value={selectedAccountId === ALL_ACCOUNTS ? (accounts[0]?.id ?? ALL_ACCOUNTS) : selectedAccountId}
            onChange={setSelectedAccountId}
            includeAll={false}
            onAdd={goAddAccount}
          />
          <TransactionsFilters
            dateRange={transactionsRange}
            setDateRange={setTransactionsRange}
          />
        </>
        : isReports
          ? <>
            <AccountFilter accounts={accounts} value={selectedAccountId} onChange={setSelectedAccountId} onAdd={goAddAccount} />
            <ReportsFilters
              reportType={reportType}
              setReportType={setReportType}
              reportPeriod={reportPeriod}
              setReportPeriod={setReportPeriod}
            />
          </>
          : isMerchants
            ? <AccountFilter accounts={accounts} value={selectedAccountId} onChange={setSelectedAccountId} onAdd={goAddAccount} />
            : undefined;

  return (
    <div className="app">
      <Sidebar />

      <main className="main">
        <PageHeader
          title={meta.title}
          subtitle={meta.subtitle}
          filters={filters}
          actions={<>
            <PrivacyToggle masked={maskAmounts} onToggle={() => setMaskAmounts(m => !m)} />
            <NotificationBell onDockChange={setRemindersDock} />
          </>}
          onSettings={() => setIsSettings(true)}
        />

        <Modal
          open={showCreate}
          onClose={() => setShowCreate(false)}
          title="Add Account"
          subtitle="Link a bank account to start importing statements."
          width={560}
          zIndex="var(--z-modal-top)"
        >
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
        </Modal>

        <Settings
          isOpen={isSettingsOpen}
          onClose={() => setIsSettings(false)}
          onAddAccount={() => setShowCreate(true)}
          onAccountCreated={fetchAccounts}
          accounts={accounts}
          setAccounts={setAccounts}
        />
        <section className="content" style={{ marginRight: remindersDock, transition: "margin-right 0.2s ease" }}>
          <Outlet context={{
            accounts,
            insightRange,
            insightGroupBy,
            trendsPeriod,
            trendsRange,
            transactionsRange,
            reportType,
            reportPeriod,
          }} />
        </section>
      </main>
    </div>
  );
}