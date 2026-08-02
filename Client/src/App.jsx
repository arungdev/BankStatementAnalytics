import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import api from "./api/client";
import { useAccount } from "./context/useAccount";
import { Modal, useAuth, usePersistedState } from "@common/client";
import { usePrivacy } from "./context/usePrivacy";
import { FiHelpCircle } from "react-icons/fi";
import CreateAccount from "./components/CreateAccount";
import OnboardingGuide from "./components/OnboardingGuide";
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
import Transfers from "./pages/Transfers";
import Budgets from "./pages/Budgets";
import Investments from "./pages/Investments";
import Reports from "./pages/Reports";
import useBillReminders, { useImportFailureNotifications } from "./hooks/useBillReminders";
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

  // Same markup/classes as the pre-mount splash in index.html (styled there),
  // so the hand-off from static HTML to React is seamless.
  if (loading) return <div className="boot-splash"><div className="boot-spinner" /></div>;

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
        <Route path="/transfers" element={<Transfers />} />
        <Route path="/upload" element={<UploadStatement />} />
        <Route path="/insights" element={<Insights />} />
        <Route path="/bills" element={<Bills />} />
        <Route path="/budgets" element={<Budgets />} />
        <Route path="/investments" element={<Investments />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}

const PAGE_META = {
  '/': { title: 'Overview', subtitle: 'Your account at a glance' },
  '/trends': { title: 'Trends', subtitle: 'Income vs. spends over time' },
  '/transactions': { title: 'Transactions' },
  '/merchants': { title: 'Merchants', subtitle: 'Who you transact with, and how they’re categorized' },
  '/transfers': { title: 'Transfers', subtitle: 'Money moved between your own accounts' },
  '/upload': { title: 'Upload Statement' },
  '/insights': { title: 'Spending Insights', subtitle: 'Where your money goes' },
  '/bills': { title: 'Bills & Reminders', subtitle: 'Upcoming recurring bills' },
  '/budgets': { title: 'Budgets', subtitle: 'Monthly limits by category' },
  '/investments': { title: 'Investments', subtitle: 'Recurring & fixed deposits' },
  '/reports': { title: 'Reports', subtitle: 'Monthly & yearly summary' },
  '/settings': { title: 'Settings', subtitle: 'Accounts, categories, and preferences' },
};

function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { selectedAccountId, setSelectedAccountId } = useAccount();
  // Consuming the privacy flag here re-renders Layout (and, via the fresh
  // outlet context object, every page that reads useOutletContext) on toggle.
  // Pages that read no outlet context (Bills/Budgets/Investments/Merchants)
  // don't re-render from this alone — React Router bails out on the cached
  // outlet element — so those pages call usePrivacy() themselves.
  const { maskAmounts, setMaskAmounts } = usePrivacy();
  const { username } = useAuth();

  // ── First-login onboarding guide ──────────────────────────────────────
  // Auto-opens once per user (flag kept in localStorage, keyed by username);
  // the header ? button reopens it anytime.
  const guideSeenKey = username ? `guideSeen:${username}` : null;
  const [guideOpen, setGuideOpen] = useState(false);
  useEffect(() => {
    if (guideSeenKey && !localStorage.getItem(guideSeenKey)) setGuideOpen(true);
  }, [guideSeenKey]);
  const closeGuide = () => {
    setGuideOpen(false);
    if (guideSeenKey) localStorage.setItem(guideSeenKey, "1");
  };

  // Fire desktop reminders for bills due soon and for failed auto-imports
  // (opt-in; see Settings → Reminders).
  useBillReminders();
  useImportFailureNotifications();

  const [accounts, setAccounts] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  // Settings is a routed page (/settings) rather than a modal.
  const goSettings = () => navigate('/settings');
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
      .then(res => setAccounts(res.data))
      .catch(() => setAccounts([]));
  }, []);

  // Keep the global selection pointing at a real account. Watching `accounts`
  // (not just the selection) means the first created account gets selected
  // immediately instead of only after a full page reload. Optimistic temp
  // entries (string ids) are never auto-selected.
  useEffect(() => {
    const real = accounts.filter(a => typeof a.id === 'number');
    if (real.length === 0) return;
    // "All accounts" is a valid selection even though no account has that id.
    const stillExists = selectedAccountId === ALL_ACCOUNTS
      || real.some(a => a.id === selectedAccountId);
    if (!selectedAccountId || !stillExists)
      setSelectedAccountId(real[0].id);
  }, [accounts, selectedAccountId, setSelectedAccountId]);

  const meta = PAGE_META[location.pathname] ?? { title: '' };
  const isInsights = location.pathname === '/insights';
  const isTrends = location.pathname === '/trends';
  const isTransactions = location.pathname === '/transactions';
  const isReports = location.pathname === '/reports';

  // Opens the Create Account modal directly, skipping the Settings detour.
  const goAddAccount = () => setShowCreate(true);

  // The account selector is app-level, not per-page: it lives in the header's
  // title row (beside the privacy/notification controls) so it stays in one
  // place on every route instead of being repeated in each page's filter row.
  // Pages that can't aggregate (Transactions, Upload) narrow "All accounts"
  // down to a single account themselves.
  const accountSelector = (
    <AccountFilter
      accounts={accounts}
      value={selectedAccountId}
      onChange={setSelectedAccountId}
      onAdd={goAddAccount}
      align="right"
    />
  );

  // Row 2 now carries only the genuinely page-scoped filters; pages with none
  // (Overview, Merchants, Investments, …) leave it undefined so it isn't drawn.
  const filters = isInsights
    ? <InsightsFilters
      range={insightRange}
      setRange={setInsightRange}
      groupBy={insightGroupBy}
      setGroupBy={setInsightGroupBy}
    />
    : isTrends
      ? <TrendsFilters
        period={trendsPeriod}
        setPeriod={setTrendsPeriod}
        dateRange={trendsRange}
        setDateRange={setTrendsRange}
      />
      : isTransactions
        ? <TransactionsFilters
          dateRange={transactionsRange}
          setDateRange={setTransactionsRange}
        />
        : isReports
          ? <ReportsFilters
            reportType={reportType}
            setReportType={setReportType}
            reportPeriod={reportPeriod}
            setReportPeriod={setReportPeriod}
          />
          : undefined;

  return (
    <div className="app app-fade">
      <Sidebar />

      <main className="main">
        <PageHeader
          title={meta.title}
          subtitle={meta.subtitle}
          filters={filters}
          actions={<>
            {accountSelector}
            {/* Separates the account scope from the action buttons beside it. */}
            <span style={{ width: '1px', height: '22px', background: 'var(--border-color)', flexShrink: 0 }} />
            <button
              onClick={() => setGuideOpen(true)}
              className="btn icon"
              style={{ borderRadius: '50%', width: '36px', height: '36px', color: 'var(--text-muted)', flexShrink: 0 }}
              title="How to use this app"
              aria-label="Open the getting-started guide"
            >
              <FiHelpCircle size={17} />
            </button>
            <PrivacyToggle masked={maskAmounts} onToggle={() => setMaskAmounts(m => !m)} />
            <NotificationBell onDockChange={setRemindersDock} accounts={accounts} />
          </>}
        />

        <OnboardingGuide
          open={guideOpen}
          onClose={closeGuide}
          hasAccounts={accounts.some(a => typeof a.id === 'number')}
          onAddAccount={() => setShowCreate(true)}
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

        <section key={location.pathname} className="content route-fade" style={{ marginRight: remindersDock, transition: "margin-right 0.2s ease" }}>
          <Outlet context={{
            accounts,
            setAccounts,
            openAddAccount: () => setShowCreate(true),
            onAccountCreated: fetchAccounts,
            openSettings: goSettings,
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