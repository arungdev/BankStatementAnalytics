import { useState, useEffect } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { FiCreditCard, FiTag, FiUser, FiPlus, FiEdit2, FiX, FiBell, FiSun, FiMoon, FiMonitor, FiEye, FiEyeOff, FiChevronDown, FiChevronUp, FiFolder, FiDownloadCloud, FiClock, FiRotateCcw, FiAlertCircle, FiCheckCircle } from "react-icons/fi";
import api from "../api/client";
import { updateCardSettings } from "../api/cards";
import { updateAutoImport, browseFolders } from "../api/accounts";
import { triggerAutoImportSweep, getAutoImports, retryAutoImport } from "../api/statements";
import { useAccount } from "../context/useAccount";
import { useAuth } from "../context/useAuth";
import { usePrivacy } from "../context/usePrivacy";
import useTheme from "../context/useTheme";
import { FONT_SIZE_OPTIONS } from "../context/ThemeContext";
import ProfileSettings from "../components/ProfileSettings";
import Badge from "../components/ui/Badge";
import Drawer from "../components/ui/Drawer";
import { REMINDERS_ENABLED_KEY, REMINDER_WINDOW_KEY, sendTestNotification } from "../hooks/useBillReminders";
import { currencyFormatterFull, formatDate } from "../utils/format";
import "./Settings.css";

export default function Settings() {
  const {
    accounts = [],
    setAccounts,
    openAddAccount,
    onAccountCreated,
  } = useOutletContext() ?? {};
  const [searchParams, setSearchParams] = useSearchParams();
  const { selectedAccountId, setSelectedAccountId } = useAccount();
  const { isAdmin } = useAuth();
  const { preference, setPreference, fontSize, setFontSize } = useTheme();
  const { maskAmounts, maskNamesEnabled, setMaskNamesEnabled } = usePrivacy();
  const activeTab = searchParams.get('tab') || 'accounts';
  const setActiveTab = (tab) =>
    setSearchParams(tab === 'accounts' ? {} : { tab }, { replace: true });
  const [categories, setCategories] = useState([]);

  // Category states
  const [newCatName, setNewCatName] = useState("");
  const [editingCatId, setEditingCatId] = useState(null);
  const [editCatName, setEditCatName] = useState("");

  // Sub-category states
  const [newSubCatName, setNewSubCatName] = useState("");
  const [activeSubCatInputId, setActiveSubCatInputId] = useState(null);

  // Account states
  const [editingAccountId, setEditingAccountId] = useState(null);
  const [editAccountName, setEditAccountName] = useState("");

  // Credit-card metadata drafts (credit limit / statement day), keyed by account id.
  // Values usually come parsed from the PDF statement; these fields are the manual fallback.
  const [cardDrafts, setCardDrafts] = useState({});
  const cardDraft = (acc) => cardDrafts[acc.id] ?? {
    creditLimit: acc.creditLimit ?? "",
    statementDay: acc.statementDay ?? "",
    sharedLimitAccountId: acc.sharedLimitAccountId ?? "",
  };
  const setCardDraft = (id, patch) =>
    setCardDrafts(prev => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...patch } }));

  const handleSaveCardSettings = async (acc) => {
    const d = cardDraft(acc);
    const body = {
      creditLimit: d.creditLimit === "" ? null : Number(d.creditLimit),
      statementDay: d.statementDay === "" ? null : Number(d.statementDay),
      sharedLimitAccountId: d.sharedLimitAccountId === "" ? null : Number(d.sharedLimitAccountId),
    };
    if (body.statementDay != null && (body.statementDay < 1 || body.statementDay > 31)) {
      alert("Statement day must be between 1 and 31.");
      return;
    }
    if (body.creditLimit != null && body.creditLimit < 0) {
      alert("Credit limit cannot be negative.");
      return;
    }
    try {
      // The API normalizes the link (e.g. joins the target's existing group),
      // so reflect what it saved rather than what was sent.
      const res = await updateCardSettings(acc.id, body);
      setAccounts(accounts.map(a =>
        a.id === acc.id
          ? { ...a, creditLimit: res.data.creditLimit, statementDay: res.data.statementDay, sharedLimitAccountId: res.data.sharedLimitAccountId }
          : a));
      setCardDrafts(prev => { const next = { ...prev }; delete next[acc.id]; return next; });
    } catch (err) {
      console.error("Failed to update card settings", err);
      alert(err.response?.data || "Failed to update card settings. Please try again.");
    }
  };

  // Auto-import drafts (watch folder / statement PDF password), keyed by account id.
  // The password is write-only: the API never echoes it, only hasStatementPassword.
  const [autoDrafts, setAutoDrafts] = useState({});
  // Collapsed by default; toggled open per account.
  const [autoOpen, setAutoOpen] = useState({});
  // Defaults first so a partial draft (e.g. only the folder picked via Browse…)
  // never leaves the other field undefined/uncontrolled.
  const autoDraft = (acc) => ({
    watchFolderPath: acc.watchFolderPath ?? "",
    statementPassword: "",
    ...(autoDrafts[acc.id] ?? {}),
  });
  const setAutoDraft = (id, patch) =>
    setAutoDrafts(prev => ({ ...prev, [id]: { ...(prev[id] ?? autoDrafts[id] ?? {}), ...patch } }));

  const handleSaveAutoImport = async (acc, { clearPassword = false } = {}) => {
    const d = autoDraft(acc);
    const body = {
      watchFolderPath: d.watchFolderPath.trim(),
      // null = leave the saved password unchanged, "" = clear it.
      statementPassword: clearPassword ? "" : (d.statementPassword === "" ? null : d.statementPassword),
    };
    try {
      const res = await updateAutoImport(acc.id, body);
      setAccounts(accounts.map(a =>
        a.id === acc.id
          ? { ...a, watchFolderPath: res.data.watchFolderPath, watchEnabled: res.data.watchEnabled, hasStatementPassword: res.data.hasStatementPassword }
          : a));
      setAutoDrafts(prev => { const next = { ...prev }; delete next[acc.id]; return next; });
    } catch (err) {
      console.error("Failed to update auto-import settings", err);
      alert(err.response?.data?.message || "Failed to update auto-import settings. Please try again.");
    }
  };

  // Pause/resume the watcher without losing the configured folder or password.
  const handleToggleAutoImport = async (acc) => {
    try {
      const res = await updateAutoImport(acc.id, {
        watchFolderPath: acc.watchFolderPath ?? "",
        enabled: !acc.watchEnabled,
      });
      setAccounts(accounts.map(a =>
        a.id === acc.id
          ? { ...a, watchFolderPath: res.data.watchFolderPath, watchEnabled: res.data.watchEnabled, hasStatementPassword: res.data.hasStatementPassword }
          : a));
    } catch (err) {
      console.error("Failed to toggle auto-import", err);
      alert("Failed to update auto-import. Please try again.");
    }
  };

  // Per-account show/hide for the statement-password input.
  const [showPw, setShowPw] = useState({});

  // "Checking…" feedback while Import now runs; the request resolves only once
  // the server-side sweep has finished, so other pages refetch up-to-date data.
  const [sweeping, setSweeping] = useState({});
  const handleImportNow = async (acc) => {
    setSweeping(prev => ({ ...prev, [acc.id]: true }));
    try {
      await triggerAutoImportSweep();
    } catch (err) {
      console.error("Failed to trigger import sweep", err);
      alert("Could not start the import. Please try again.");
    } finally {
      setSweeping(prev => { const next = { ...prev }; delete next[acc.id]; return next; });
    }
  };

  // Auto-import history drawer (RHS) — one account at a time. Rows come from
  // ImportHistory on the server, so failures show up even though they leave no
  // Upload row. Failed rows offer a retry (with an optional one-time password).
  const [historyAcc, setHistoryAcc] = useState(null);
  const [historyItems, setHistoryItems] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyWidth, setHistoryWidth] = useState(450);
  const [retryPw, setRetryPw] = useState({});
  const [retrying, setRetrying] = useState({});

  const loadHistory = (acc) => {
    setHistoryLoading(true);
    getAutoImports(acc.id)
      .then(res => setHistoryItems(res.data || []))
      .catch(() => setHistoryItems([]))
      .finally(() => setHistoryLoading(false));
  };
  const openHistory = (acc) => { setHistoryAcc(acc); loadHistory(acc); };

  const handleRetryImport = async (fail) => {
    setRetrying(prev => ({ ...prev, [fail.id]: true }));
    try {
      await retryAutoImport(fail.id, retryPw[fail.id] || undefined);
      setRetryPw(prev => { const next = { ...prev }; delete next[fail.id]; return next; });
      if (historyAcc) loadHistory(historyAcc);
    } catch (err) {
      alert(err.response?.data?.message || "Retry failed. Please try again.");
    } finally {
      setRetrying(prev => { const next = { ...prev }; delete next[fail.id]; return next; });
    }
  };

  // Server-side folder browser backing the Browse… button (one open at a time).
  // Browsers never expose real filesystem paths, so the backend lists folders.
  const [browse, setBrowse] = useState(null); // { accId, path, parent, folders, error }

  const loadBrowse = async (accId, path) => {
    try {
      const res = await browseFolders(path || undefined);
      setBrowse({ accId, ...res.data, error: null });
    } catch (err) {
      setBrowse(prev => prev && prev.accId === accId
        ? { ...prev, error: err.response?.data?.message || "Could not open folder." }
        : prev);
    }
  };

  const openBrowse = async (acc) => {
    try {
      const res = await browseFolders(autoDraft(acc).watchFolderPath.trim() || undefined);
      setBrowse({ accId: acc.id, ...res.data, error: null });
    } catch {
      // Typed path doesn't exist — start from the drive list instead.
      try {
        const res = await browseFolders();
        setBrowse({ accId: acc.id, ...res.data, error: null });
      } catch {
        alert("Could not open the folder browser.");
      }
    }
  };

  // Reminder states (client-side preferences persisted in localStorage)
  const [remEnabled, setRemEnabled] = useState(() => localStorage.getItem(REMINDERS_ENABLED_KEY) === "true");
  const [remWindow, setRemWindow] = useState(() => Number(localStorage.getItem(REMINDER_WINDOW_KEY)) || 7);
  const [notifPermission, setNotifPermission] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );

  const toggleReminders = async () => {
    if (remEnabled) {
      localStorage.setItem(REMINDERS_ENABLED_KEY, "false");
      setRemEnabled(false);
      return;
    }
    if (typeof Notification === "undefined") {
      alert("Desktop notifications aren't supported in this browser.");
      return;
    }
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    setNotifPermission(perm);
    if (perm !== "granted") {
      alert("Please allow notifications in your browser to enable desktop reminders.");
      return;
    }
    localStorage.setItem(REMINDERS_ENABLED_KEY, "true");
    setRemEnabled(true);
    // Immediately confirm it works so the user sees a toast the moment they opt in.
    sendTestNotification();
  };

  const updateWindow = (days) => {
    const n = Math.max(1, Math.min(31, Number(days) || 7));
    setRemWindow(n);
    localStorage.setItem(REMINDER_WINDOW_KEY, String(n));
  };

  const handleTestNotification = async () => {
    const res = await sendTestNotification();
    if (res.ok) return; // toast shown
    setNotifPermission(typeof Notification !== "undefined" ? Notification.permission : "unsupported");
    if (res.reason === "unsupported") {
      alert("Desktop notifications aren't supported in this browser.");
    } else if (res.reason === "denied") {
      alert("Notifications are blocked for this site. Allow them in your browser's site settings (the icon in the address bar), then try again.");
    } else if (res.reason === "default") {
      alert("Notification permission wasn't granted. Click Enable and choose Allow when prompted.");
    } else {
      alert("Could not show a notification: " + (res.error || "unknown error"));
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await api.get("/categories");
      setCategories(res.data || []);
    } catch (err) {
      console.error("Failed to load categories", err);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const handleAddCategory = async () => {
    const name = newCatName.trim();
    if (!name) return;
    if (categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
      alert(`A category named "${name}" already exists.`);
      return;
    }
    try {
      const res = await api.post("/categories", { name });
      setCategories([...categories, res.data]);
      setNewCatName("");
    } catch (err) {
      console.error(err);
      alert("Failed to add category. Please try again.");
    }
  };

  const handleDeleteCategory = async (id, name) => {
    if (!window.confirm(`Delete category "${name}"? Transactions using it will become uncategorized.`)) return;
    try {
      await api.delete(`/categories/${id}`);
      setCategories(categories.filter(c => c.id !== id));
    } catch (err) {
      console.error(err);
      alert("Failed to delete category. Please try again.");
    }
  };

  const handleUpdateCategory = async (id) => {
    if (!editCatName.trim()) return;
    try {
      await api.put(`/categories/${id}`, { name: editCatName.trim() });
      setCategories(categories.map(c => c.id === id ? { ...c, name: editCatName.trim() } : c));
      setEditingCatId(null);
    } catch (err) {
      console.error(err);
      alert("Failed to update category. Please try again.");
    }
  };

  const handleAddSubCategory = async (catId) => {
    const name = newSubCatName.trim();
    if (!name) return;
    try {
      await api.post(`/categories/${catId}/subcategories`, { name });
      setCategories(categories.map(c =>
        c.id === catId ? { ...c, subCategories: [...(c.subCategories || []), name] } : c
      ));
      setNewSubCatName("");
      setActiveSubCatInputId(null);
    } catch (err) {
      console.error(err);
      alert("Failed to add sub-category. Please try again.");
    }
  };

  const handleDeleteSubCategory = async (catId, subCatIndex, subCatName) => {
    if (!window.confirm(`Delete sub-category "${subCatName}"?`)) return;
    try {
      await api.delete(`/categories/${catId}/subcategories/${encodeURIComponent(subCatName)}`);
      setCategories(categories.map(c => {
        if (c.id === catId) {
          const newSub = [...(c.subCategories || [])];
          newSub.splice(subCatIndex, 1);
          return { ...c, subCategories: newSub };
        }
        return c;
      }));
    } catch (err) {
      console.error(err);
      alert("Failed to delete sub-category. Please try again.");
    }
  };

  const handleUpdateAccount = async (id) => {
    if (!editAccountName.trim()) return;
    try {
      await api.put(`/accounts/${id}`, { accountHolderName: editAccountName.trim() });
      setAccounts(accounts.map(a => a.id === id ? { ...a, accountHolderName: editAccountName.trim() } : a));
      setEditingAccountId(null);
      onAccountCreated?.();
    } catch (err) {
      console.error("Failed to update account", err);
      alert("Failed to update account. Please try again.");
    }
  };

  const handleDeleteAccount = async (id) => {
    if (!window.confirm("Are you sure you want to delete this account? All associated transactions will be removed permanently.")) return;
    try {
      await api.delete(`/accounts/${id}`);
      setAccounts(accounts.filter(a => a.id !== id));
      if (selectedAccountId === id) setSelectedAccountId(null);
      onAccountCreated?.();
    } catch (err) {
      console.error("Failed to delete account", err);
      alert("Failed to delete account. Please try again.");
    }
  };

  const TABS = [
    { id: 'accounts', label: 'Accounts', icon: <FiCreditCard size={17} /> },
    { id: 'categories', label: 'Categories', icon: <FiTag size={17} /> },
    { id: 'reminders', label: 'Reminders', icon: <FiBell size={17} /> },
    { id: 'privacy', label: 'Privacy', icon: <FiEyeOff size={17} /> },
    { id: 'appearance', label: 'Appearance', icon: <FiSun size={17} /> },
    { id: 'profile', label: 'Profile', icon: <FiUser size={17} /> },
  ];

  const HEADERS = {
    accounts: { title: 'Manage Accounts', subtitle: 'Add, rename, or remove your linked bank accounts.' },
    categories: { title: 'Categories', subtitle: 'Organize your spending into categories and sub-categories.' },
    reminders: { title: 'Bill Reminders', subtitle: 'Get a desktop notification when a recurring bill is due soon.' },
    privacy: { title: 'Privacy', subtitle: 'Choose what the privacy toggle (eye icon) hides on screen.' },
    appearance: { title: 'Appearance', subtitle: 'Choose how the app looks on this device.' },
    profile: { title: 'Profile', subtitle: 'Manage your account and personal details.' },
  };

  const THEME_OPTIONS = [
    { id: 'system', label: 'System', sub: 'Follow your device setting', icon: <FiMonitor size={20} /> },
    { id: 'light', label: 'Light', sub: 'Bright surfaces, dark text', icon: <FiSun size={20} /> },
    { id: 'dark', label: 'Dark', sub: 'Dim surfaces, light text', icon: <FiMoon size={20} /> },
  ];

  return (
    <div className="settings-page">
      {/* Tabs + section header stay pinned together; only the body scrolls. */}
      <div className="settings-topbar">
        <nav className="settings-tabs" role="tablist" aria-label="Settings sections">
          {TABS.map(tab => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`settings-tab${activeTab === tab.id ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>

        <header className="settings-header">
          <div className="settings-header-text">
            <h1 className="settings-title">{HEADERS[activeTab].title}</h1>
            <p className="settings-subtitle">{HEADERS[activeTab].subtitle}</p>
          </div>
          {activeTab === 'accounts' && isAdmin && (
            <button
              className="btn primary small"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              onClick={() => openAddAccount?.()}
            >
              <FiPlus size={15} /> Add Account
            </button>
          )}
        </header>
      </div>

      <div className="settings-body">

            {/* ── Profile ── */}
            {activeTab === 'profile' && <ProfileSettings />}

            {/* ── Appearance ── */}
            {activeTab === 'appearance' && (
              <div className="settings-list">
                <div className="appearance-section">
                  <h3 className="appearance-section-title">Theme</h3>
                  <div className="theme-options" role="radiogroup" aria-label="Theme">
                    {THEME_OPTIONS.map(opt => (
                      <button
                        key={opt.id}
                        role="radio"
                        aria-checked={preference === opt.id}
                        className={`theme-option${preference === opt.id ? ' active' : ''}`}
                        onClick={() => setPreference(opt.id)}
                      >
                        <span className="theme-option-icon">{opt.icon}</span>
                        <span className="theme-option-label">{opt.label}</span>
                        <span className="theme-option-sub">{opt.sub}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="appearance-section">
                  <h3 className="appearance-section-title">Text size</h3>
                  <p className="settings-row-sub" style={{ marginBottom: '12px' }}>
                    Scales all text across the app. Applies instantly and is remembered on this device.
                  </p>
                  <div className="text-size-options" role="radiogroup" aria-label="Text size">
                    {FONT_SIZE_OPTIONS.map(opt => (
                      <button
                        key={opt.id}
                        role="radio"
                        aria-checked={fontSize === opt.id}
                        className={`text-size-option${fontSize === opt.id ? ' active' : ''}`}
                        onClick={() => setFontSize(opt.id)}
                      >
                        <span
                          className="text-size-option-preview"
                          style={{ fontSize: `${opt.scale}em` }}
                        >
                          Aa
                        </span>
                        <span className="text-size-option-label">{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── Reminders ── */}
            {activeTab === 'reminders' && (
              <div className="settings-list">
                <div className="settings-row">
                  <div className="settings-row-head">
                    <div style={{ minWidth: 0 }}>
                      <h3 className="settings-row-title">Desktop notifications</h3>
                      <p className="settings-row-sub">
                        Show a Windows notification when a confirmed bill is due within your reminder window.
                        Reminders fire while the app is open.
                      </p>
                    </div>
                    <div className="settings-row-actions" style={{ gap: '8px' }}>
                      <button className="btn small" onClick={handleTestNotification}>
                        Send test
                      </button>
                      <button
                        className={`btn small${remEnabled ? '' : ' primary'}`}
                        onClick={toggleReminders}
                      >
                        {remEnabled ? 'Disable' : 'Enable'}
                      </button>
                    </div>
                  </div>

                  {notifPermission === 'denied' && (
                    <p className="settings-row-sub" style={{ color: 'var(--danger, #ef4444)' }}>
                      Notifications are blocked in your browser settings. Allow them for this site (click the icon in the address bar) to use reminders.
                    </p>
                  )}
                  <p className="settings-row-sub" style={{ marginTop: '8px' }}>
                    Tip: if a toast doesn't pop up, check Windows notification settings —
                    turn off Focus assist / Do not disturb, and make sure notifications are on
                    for your browser. The toast may also appear in the Windows Action Center.
                  </p>
                </div>

                <div className="settings-row">
                  <div className="settings-row-head">
                    <div style={{ minWidth: 0 }}>
                      <h3 className="settings-row-title">Reminder window</h3>
                      <p className="settings-row-sub">Remind me this many days before a bill is due.</p>
                    </div>
                    <div className="settings-row-actions" style={{ alignItems: 'center', gap: '8px' }}>
                      <input
                        type="number"
                        min="1"
                        max="31"
                        value={remWindow}
                        onChange={(e) => updateWindow(e.target.value)}
                        className="field-input"
                        style={{ width: '72px' }}
                      />
                      <span className="settings-row-sub">days</span>
                    </div>
                  </div>
                </div>

              </div>
            )}

            {/* ── Privacy ── */}
            {activeTab === 'privacy' && (
              <div className="settings-list">
                <div className="settings-row">
                  <div className="settings-row-head">
                    <div style={{ minWidth: 0 }}>
                      <h3 className="settings-row-title">Hide amounts</h3>
                      <p className="settings-row-sub">
                        The eye icon in the page header always hides monetary amounts. It's currently
                        {maskAmounts ? ' on' : ' off'} — toggle it from any page header.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="settings-row">
                  <div className="settings-row-head">
                    <div style={{ minWidth: 0 }}>
                      <h3 className="settings-row-title">Also hide merchant names</h3>
                      <p className="settings-row-sub">
                        While the eye toggle is on, merchant and bill names are reduced to their
                        first letter (e.g. "S•••") across transactions, merchants, bills and insights.
                      </p>
                    </div>
                    <div className="settings-row-actions">
                      <button
                        className={`btn small${maskNamesEnabled ? '' : ' primary'}`}
                        onClick={() => setMaskNamesEnabled(v => !v)}
                      >
                        {maskNamesEnabled ? 'Disable' : 'Enable'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Accounts ── */}
            {activeTab === 'accounts' && (
              accounts.length === 0 ? (
                <div className="settings-empty">
                  <FiCreditCard size={36} />
                  <div className="settings-empty-title">No accounts yet</div>
                  <div className="settings-empty-sub">
                    {isAdmin ? 'Click “Add Account” to link your first bank account.' : 'No accounts have been added.'}
                  </div>
                </div>
              ) : (
                <div className="settings-list">
                  {accounts.map(acc => (
                    <div key={acc.id} className="settings-row">
                      <div className="settings-row-head">
                        <div className="settings-row-main">
                          <div className="settings-avatar">
                            {(acc.bankName || acc.accountHolderName || '?').charAt(0)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            {editingAccountId === acc.id ? (
                              <input
                                type="text"
                                value={editAccountName}
                                onChange={(e) => setEditAccountName(e.target.value.slice(0, 50))}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleUpdateAccount(acc.id);
                                  if (e.key === 'Escape') { e.stopPropagation(); setEditingAccountId(null); }
                                }}
                                maxLength={50}
                                autoFocus
                                className="field-input"
                              />
                            ) : (
                              <h3 className="settings-row-title">{acc.accountHolderName || acc.bankName}</h3>
                            )}
                            <p className="settings-row-sub">
                              {acc.bankName} ending in {acc.accountNumber?.slice(-4) || '****'}
                            </p>
                            {acc.lastTransaction && (
                              <p className="settings-row-sub settings-row-lasttxn">
                                Last txn: {formatDate(acc.lastTransaction.date)}
                              </p>
                            )}
                          </div>
                        </div>

                        {acc.balance != null && (
                          <div className="settings-row-balance">
                            <span className="settings-row-balance-label">{acc.balanceLabel || 'Balance'}</span>
                            <span className="settings-row-balance-value">{currencyFormatterFull.format(acc.balance)}</span>
                          </div>
                        )}

                        {isAdmin && (
                          <div className="settings-row-actions">
                            {editingAccountId === acc.id ? (
                              <>
                                <button className="btn primary small" onClick={() => handleUpdateAccount(acc.id)}>Save</button>
                                <button className="btn small" onClick={() => setEditingAccountId(null)}>Cancel</button>
                              </>
                            ) : (
                              <>
                                <button
                                  className="btn small"
                                  onClick={() => { setEditingAccountId(acc.id); setEditAccountName(acc.accountHolderName || ''); }}
                                >
                                  Rename
                                </button>
                                <button className="btn danger small" onClick={() => handleDeleteAccount(acc.id)}>Delete</button>
                              </>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Credit-card-only metadata: usually auto-filled from the PDF
                          statement; editable here as the manual fallback. */}
                      {acc.bankName === 'HDFCCreditCard' && isAdmin && (
                        <div className="settings-panel">
                          <div className="settings-field-grid">
                            <label className="settings-field sm">
                              <span className="settings-field-label">Credit limit (₹)</span>
                              <input
                                type="number"
                                min="0"
                                placeholder="e.g. 100000"
                                value={cardDraft(acc).creditLimit}
                                onChange={(e) => setCardDraft(acc.id, { creditLimit: e.target.value })}
                                className="field-input"
                              />
                            </label>
                            <label className="settings-field sm">
                              <span className="settings-field-label">Statement day (1–31)</span>
                              <input
                                type="number"
                                min="1"
                                max="31"
                                placeholder="e.g. 23"
                                value={cardDraft(acc).statementDay}
                                onChange={(e) => setCardDraft(acc.id, { statementDay: e.target.value })}
                                className="field-input"
                              />
                            </label>
                            {/* HDFC add-on/second cards draw on the primary card's limit;
                                linking them makes utilization count both cards together. */}
                            {accounts.some(a => a.bankName === 'HDFCCreditCard' && a.id !== acc.id) && (
                              <label className="settings-field lg">
                                <span className="settings-field-label">Shares limit with</span>
                                <select
                                  value={cardDraft(acc).sharedLimitAccountId}
                                  onChange={(e) => setCardDraft(acc.id, { sharedLimitAccountId: e.target.value })}
                                  className="field-input"
                                >
                                  <option value="">None (own limit)</option>
                                  {accounts
                                    .filter(a => a.bankName === 'HDFCCreditCard' && a.id !== acc.id)
                                    .map(a => (
                                      <option key={a.id} value={a.id}>
                                        •••• {a.accountNumber?.slice(-4) || a.id}
                                      </option>
                                    ))}
                                </select>
                              </label>
                            )}
                          </div>
                          {cardDrafts[acc.id] && (
                            <div className="settings-panel-actions">
                              <button className="btn primary small" onClick={() => handleSaveCardSettings(acc)}>
                                Save card settings
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Auto-import: a folder the backend sweeps ~once a minute,
                          importing new statement files like a manual upload.
                          Collapsed by default to keep the account row compact. */}
                      {isAdmin && (
                        <div className="settings-panel">
                          <button
                            className="btn small auto-import-toggle"
                            onClick={() => setAutoOpen(prev => ({ ...prev, [acc.id]: !prev[acc.id] }))}
                          >
                            Auto-import
                            {acc.watchFolderPath && (acc.watchEnabled
                              ? <Badge variant="green">On</Badge>
                              : <Badge variant="amber">Paused</Badge>)}
                            {autoOpen[acc.id] ? <FiChevronUp size={12} /> : <FiChevronDown size={12} />}
                          </button>
                          {autoOpen[acc.id] && (
                          <>
                          <div className="settings-field-grid" style={{ marginTop: 'var(--space-4)' }}>
                            <label className="settings-field grow">
                              <span className="settings-field-label">Auto-import folder</span>
                              <input
                                type="text"
                                placeholder="e.g. D:\Statements\HDFC"
                                value={autoDraft(acc).watchFolderPath}
                                onChange={(e) => setAutoDraft(acc.id, { watchFolderPath: e.target.value })}
                                className="field-input"
                              />
                            </label>
                            <button type="button" className="btn small" onClick={() => openBrowse(acc)}>
                              <FiFolder size={12} /> Browse…
                            </button>
                            <label className="settings-field md">
                              <span className="settings-field-label">Statement PDF password</span>
                              <span className="field-affix">
                                <input
                                  type={showPw[acc.id] ? "text" : "password"}
                                  placeholder={acc.hasStatementPassword ? "••••• (saved)" : "optional"}
                                  value={autoDraft(acc).statementPassword}
                                  onChange={(e) => setAutoDraft(acc.id, { statementPassword: e.target.value })}
                                  className="field-input"
                                />
                                <button
                                  type="button"
                                  className="field-affix-btn"
                                  title={showPw[acc.id] ? "Hide password" : "Show password"}
                                  onClick={() => setShowPw(prev => ({ ...prev, [acc.id]: !prev[acc.id] }))}
                                >
                                  {showPw[acc.id] ? <FiEyeOff size={14} /> : <FiEye size={14} />}
                                </button>
                              </span>
                            </label>
                          </div>
                          <div className="settings-panel-actions">
                            {autoDrafts[acc.id] && (
                              <button className="btn primary small" onClick={() => handleSaveAutoImport(acc)}>
                                Save auto-import
                              </button>
                            )}
                            {acc.hasStatementPassword && (
                              <button className="btn small" onClick={() => handleSaveAutoImport(acc, { clearPassword: true })}>
                                Clear password
                              </button>
                            )}
                            {acc.watchFolderPath && (
                              <button
                                type="button"
                                className={`btn small${acc.watchEnabled ? '' : ' primary'}`}
                                onClick={() => handleToggleAutoImport(acc)}
                              >
                                {acc.watchEnabled ? 'Turn off' : 'Turn on'}
                              </button>
                            )}
                            {acc.watchFolderPath && acc.watchEnabled && !autoDrafts[acc.id] && (
                              <button
                                type="button"
                                className="btn small"
                                disabled={!!sweeping[acc.id]}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                                onClick={() => handleImportNow(acc)}
                              >
                                <FiDownloadCloud size={12} />
                                {sweeping[acc.id] ? 'Checking folder…' : 'Import now'}
                              </button>
                            )}
                            {acc.watchFolderPath && (
                              <button
                                type="button"
                                className="btn small"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                                onClick={() => openHistory(acc)}
                              >
                                <FiClock size={12} /> History
                              </button>
                            )}
                          </div>
                          {browse?.accId === acc.id && (
                            <div className="folder-browser">
                              <div className="folder-browser-head">
                                <span className="folder-browser-path">
                                  {browse.path || 'Quick access & drives'}
                                </span>
                                {browse.path && (
                                  <button type="button" className="btn small" onClick={() => loadBrowse(acc.id, browse.parent)}>Up</button>
                                )}
                                <button type="button" className="btn small" onClick={() => setBrowse(null)}>Close</button>
                              </div>
                              {browse.error && (
                                <div className="folder-browser-error">{browse.error}</div>
                              )}
                              <div className="folder-browser-list">
                                {browse.folders.length === 0 ? (
                                  <div className="folder-browser-empty">No subfolders</div>
                                ) : browse.folders.map(f => (
                                  <button
                                    key={f.path}
                                    type="button"
                                    className="btn small folder-browser-item"
                                    onClick={() => loadBrowse(acc.id, f.path)}
                                  >
                                    <FiFolder size={12} style={{ flexShrink: 0 }} /> {f.name}
                                  </button>
                                ))}
                              </div>
                              {browse.path && (
                                <button
                                  type="button"
                                  className="btn primary small"
                                  style={{ marginTop: 'var(--space-2)' }}
                                  onClick={() => { setAutoDraft(acc.id, { watchFolderPath: browse.path }); setBrowse(null); }}
                                >
                                  Use this folder
                                </button>
                              )}
                            </div>
                          )}
                          <p className="settings-help-text">
                            New statement files in this folder are imported automatically about once a minute.
                            The password is stored on this computer and used to open protected PDFs.
                            Tip: in Explorer you can right-click a folder → “Copy as path” and paste it here.
                          </p>
                          </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )
            )}

            {/* ── Categories ── */}
            {activeTab === 'categories' && (
              <>
                {isAdmin && (
                  <div className="settings-add-card">
                    <label className="settings-add-card-label">Add a new category</label>
                    <div className="settings-add-row">
                      <input
                        type="text"
                        placeholder="e.g. Groceries, Rent, Travel…"
                        value={newCatName}
                        onChange={(e) => setNewCatName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddCategory(); }}
                        maxLength={50}
                        className="field-input"
                        style={{ flex: 1 }}
                      />
                      <button
                        className="btn primary"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
                        onClick={handleAddCategory}
                      >
                        <FiPlus size={15} /> Add
                      </button>
                    </div>
                  </div>
                )}

                {categories.length === 0 ? (
                  <div className="settings-empty">
                    <FiTag size={36} />
                    <div className="settings-empty-title">No categories defined</div>
                    <div className="settings-empty-sub">
                      {isAdmin ? 'Add one above to start organizing your transactions.' : 'No categories have been added.'}
                    </div>
                  </div>
                ) : (
                  <div className="settings-list">
                    {categories.map(cat => (
                      <div key={cat.id} className="settings-row">
                        {/* Category header */}
                        <div className="settings-row-head">
                          {editingCatId === cat.id ? (
                            <div className="settings-inline-edit">
                              <input
                                type="text"
                                value={editCatName}
                                onChange={(e) => setEditCatName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleUpdateCategory(cat.id);
                                  if (e.key === 'Escape') { e.stopPropagation(); setEditingCatId(null); }
                                }}
                                maxLength={50}
                                autoFocus
                                className="field-input"
                                style={{ flex: 1 }}
                              />
                              <button className="btn primary small" onClick={() => handleUpdateCategory(cat.id)}>Save</button>
                              <button className="btn small" onClick={() => setEditingCatId(null)}>Cancel</button>
                            </div>
                          ) : (
                            <h3 className="settings-row-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {cat.name}
                              {isAdmin && (
                                <button
                                  className="settings-edit-link"
                                  title="Rename category"
                                  onClick={() => { setEditingCatId(cat.id); setEditCatName(cat.name); }}
                                >
                                  <FiEdit2 size={14} />
                                </button>
                              )}
                            </h3>
                          )}
                          {isAdmin && editingCatId !== cat.id && (
                            <div className="settings-row-actions">
                              <button className="btn danger small" onClick={() => handleDeleteCategory(cat.id, cat.name)}>Delete</button>
                            </div>
                          )}
                        </div>

                        {/* Sub-categories */}
                        <div className="subcat-section">
                          <div className="subcat-label">Sub-Categories</div>
                          <div className="subcat-chips">
                            {(cat.subCategories || []).map((sub, idx) => (
                              <span key={idx} className="subcat-chip">
                                {sub}
                                {isAdmin && (
                                  <button
                                    className="subcat-chip-remove"
                                    onClick={() => handleDeleteSubCategory(cat.id, idx, sub)}
                                    title={`Remove ${sub}`}
                                    aria-label={`Remove ${sub}`}
                                  >
                                    <FiX size={13} />
                                  </button>
                                )}
                              </span>
                            ))}
                            {(cat.subCategories || []).length === 0 && activeSubCatInputId !== cat.id && (
                              <span className="subcat-empty">None yet</span>
                            )}
                          </div>

                          {isAdmin && (activeSubCatInputId === cat.id ? (
                            <div className="subcat-add-row">
                              <input
                                type="text"
                                placeholder="New sub-category"
                                value={newSubCatName}
                                onChange={(e) => setNewSubCatName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleAddSubCategory(cat.id);
                                  if (e.key === 'Escape') { e.stopPropagation(); setActiveSubCatInputId(null); }
                                }}
                                maxLength={50}
                                autoFocus
                                className="field-input"
                                style={{ fontSize: 'var(--text-sm)' }}
                              />
                              <button className="btn primary small" onClick={() => handleAddSubCategory(cat.id)}>Add</button>
                              <button className="btn small" onClick={() => setActiveSubCatInputId(null)}>Cancel</button>
                            </div>
                          ) : (
                            <button
                              className="subcat-add-btn"
                              onClick={() => { setActiveSubCatInputId(cat.id); setNewSubCatName(""); }}
                            >
                              <FiPlus size={13} /> Add Sub-Category
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

      </div>

      {/* Auto-import history — RHS drawer for one account's watch-folder runs */}
      <Drawer
        open={!!historyAcc}
        onClose={() => setHistoryAcc(null)}
        title={`Auto-import history${historyAcc ? ` — ${historyAcc.accountHolderName || historyAcc.bankName}` : ''}`}
        width={historyWidth}
        onWidthChange={setHistoryWidth}
      >
        {historyLoading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Loading…</div>
        ) : historyItems.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            No auto-imports yet. Files picked up from the watch folder will appear here.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {historyItems.map(h => (
              <div key={h.id} className="card" style={{ padding: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  {h.status === 'Success'
                    ? <FiCheckCircle size={20} color="var(--success, #16a34a)" style={{ flexShrink: 0, marginTop: '2px' }} />
                    : <FiAlertCircle size={20} color="var(--danger, #dc2626)" style={{ flexShrink: 0, marginTop: '2px' }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: 'var(--text-main)', fontSize: '14px', wordBreak: 'break-all' }}>
                      {h.fileName}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {new Date(h.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                      {h.status === 'Success'
                        ? <Badge variant="green">Imported</Badge>
                        : <Badge variant="red">Failed</Badge>}
                      {h.status !== 'Success' && h.attempts > 1 && (
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{h.attempts} attempts</span>
                      )}
                    </div>
                    {h.status !== 'Success' && h.error && (
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>{h.error}</div>
                    )}
                    {h.status !== 'Success' && isAdmin && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                        <input
                          type="password"
                          placeholder="PDF password (if needed)"
                          value={retryPw[h.id] || ''}
                          onChange={(e) => setRetryPw(prev => ({ ...prev, [h.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleRetryImport(h); }}
                          className="field-input"
                          style={{ width: '160px' }}
                        />
                        <button
                          className="btn primary small"
                          disabled={!!retrying[h.id]}
                          onClick={() => handleRetryImport(h)}
                        >
                          <FiRotateCcw size={12} /> {retrying[h.id] ? 'Retrying…' : 'Try again'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Drawer>
    </div>
  );
}