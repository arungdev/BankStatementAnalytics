import { useState, useEffect, useMemo, useRef } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { FiCreditCard, FiTag, FiUser, FiPlus, FiEdit2, FiX, FiBell, FiSun, FiMoon, FiMonitor, FiEye, FiEyeOff, FiChevronDown, FiChevronUp, FiFolder, FiDownloadCloud, FiClock, FiRotateCcw, FiAlertCircle, FiCheckCircle, FiSearch, FiCornerDownLeft, FiType, FiLock, FiRefreshCw, FiDatabase, FiDownload, FiUploadCloud, FiHelpCircle, FiGithub, FiZap, FiExternalLink } from "react-icons/fi";
import api from "../api/client";
import { updateCardSettings } from "../api/cards";
import { updateAutoImport, browseFolders } from "../api/accounts";
import { CATEGORY_NAME_MAX, validateCategoryName, findExistingName } from "../utils/categoryName";
import { triggerAutoImportSweep, getAutoImports, retryAutoImport } from "../api/statements";
import { useAccount } from "../context/useAccount";
import { Badge, Drawer, FONT_SIZE_OPTIONS, Switch, useAuth, useTheme } from "@common/client";
import { usePrivacy } from "../context/usePrivacy";
import ProfileSettings from "../components/ProfileSettings";
import { getBackupStatus, downloadBackup, restoreBackup, readApiError } from "../api/backup";
import { REMINDERS_ENABLED_KEY, REMINDER_WINDOW_KEY, sendTestNotification } from "../hooks/useBillReminders";
import { currencyFormatterFull, formatDate } from "../utils/format";
import "./Settings.css";

/* Sections of the settings page, in rail order. `hint` is the one-line
   "what lives here" shown under the label so a section can be picked without
   opening it first. */
const SECTIONS = [
  { id: 'accounts', label: 'Accounts', hint: 'Banks, cards & auto-import', icon: <FiCreditCard size={17} />, title: 'Accounts', subtitle: 'Your linked bank accounts, card details, and automatic statement imports.' },
  { id: 'categories', label: 'Categories', hint: 'How spending is grouped', icon: <FiTag size={17} />, title: 'Categories', subtitle: 'Organize your spending into categories and sub-categories.' },
  { id: 'reminders', label: 'Reminders', hint: 'Bill due alerts', icon: <FiBell size={17} />, title: 'Bill reminders', subtitle: 'Get a desktop notification when a recurring bill is due soon.' },
  { id: 'privacy', label: 'Privacy', hint: 'What the eye icon hides', icon: <FiEyeOff size={17} />, title: 'Privacy', subtitle: 'Control what is hidden on screen when someone is looking over your shoulder.' },
  { id: 'appearance', label: 'Appearance', hint: 'Theme & text size', icon: <FiSun size={17} />, title: 'Appearance', subtitle: 'Choose how the app looks on this device.' },
  { id: 'profile', label: 'Profile', hint: 'Login & users', icon: <FiUser size={17} />, title: 'Profile', subtitle: 'Manage your login and, as an admin, the other users on this app.' },
  { id: 'backup', label: 'Backup', hint: 'Save & restore everything', icon: <FiDatabase size={17} />, title: 'Backup & restore', subtitle: 'Save a copy of everything in this app, and put it back later or on another machine.' },
  { id: 'help', label: 'Help', hint: 'Report a problem', icon: <FiHelpCircle size={17} />, title: 'Help & feedback', subtitle: 'Hit a bug, or want something the app does not do yet? Raise it on GitHub — every link here opens in a new tab.' },
];

/* Flat index of every individual setting, so the search box can take you
   straight to one instead of making you guess which tab it lives under.
   `anchor` is the id of the card to scroll to and flash (may not be rendered —
   e.g. card details only exist when a credit card account is present — in
   which case we just open the section). */
const SETTINGS_INDEX = [
  { section: 'accounts', anchor: 'accounts-list', title: 'Bank accounts', desc: 'Rename, check the balance, or remove an account', keywords: 'account bank rename delete remove balance holder name number linked add' },
  { section: 'accounts', anchor: 'auto-import', title: 'Auto-import folder', desc: 'Watch a folder and import new statements automatically', keywords: 'auto import automatic watch folder statement pdf password protected browse import now history retry failed' },
  { section: 'accounts', anchor: 'card-details', title: 'Credit limit & statement day', desc: 'Card details used for utilization and billing cycles', keywords: 'credit card limit utilization statement day billing cycle shared limit add-on' },
  { section: 'categories', anchor: 'categories-list', title: 'Categories & sub-categories', desc: 'Add, rename, or delete spending categories', keywords: 'category categories sub-category subcategory spending group tag rename delete add' },
  { section: 'reminders', anchor: 'reminders-enable', title: 'Desktop notifications', desc: 'Turn bill reminders on and send a test notification', keywords: 'notification desktop reminder alert toast bill due test enable permission blocked' },
  { section: 'reminders', anchor: 'reminder-window', title: 'Reminder window', desc: 'How many days before a bill is due to remind you', keywords: 'reminder window days before due lead time' },
  { section: 'privacy', anchor: 'privacy-amounts', title: 'Hide amounts', desc: 'Mask every rupee value on screen', keywords: 'privacy hide amount mask money rupee blur eye incognito shoulder' },
  { section: 'privacy', anchor: 'privacy-names', title: 'Hide merchant names', desc: 'Also mask merchant and bill names while hiding is on', keywords: 'privacy hide merchant name payee bill mask anonymize' },
  { section: 'appearance', anchor: 'theme', title: 'Theme', desc: 'Light, dark, or follow your device', keywords: 'theme dark light system appearance colour color night mode' },
  { section: 'appearance', anchor: 'text-size', title: 'Text size', desc: 'Scale all text in the app', keywords: 'text size font bigger smaller zoom scale accessibility readable' },
  { section: 'profile', anchor: 'profile-account', title: 'Your login', desc: 'Signed-in user and role', keywords: 'profile username role admin signed in login account' },
  { section: 'profile', anchor: 'profile-account', title: 'Change password', desc: 'Set a new password for your login', keywords: 'change password reset credentials security login' },
  { section: 'profile', anchor: 'profile-users', title: 'Users', desc: 'Add, disable, or delete other users', keywords: 'user users add create disable delete role admin permission access' },
  { section: 'backup', anchor: 'backup-download', title: 'Download a backup', desc: 'Save every account, transaction and statement file to one zip', keywords: 'backup download save export zip copy archive data safety disaster move machine' },
  { section: 'backup', anchor: 'backup-restore', title: 'Restore from a backup', desc: 'Replace everything in this app with the contents of a backup', keywords: 'restore import upload recover revert replace rollback zip backup migrate' },
  { section: 'help', anchor: 'issue-bug', title: 'Report a problem', desc: 'Raise a bug on GitHub with the details already laid out', keywords: 'issue bug report problem raise complaint broken error crash wrong parse support help feedback github' },
  { section: 'help', anchor: 'issue-feature', title: 'Suggest a feature', desc: 'Ask for a new bank, chart, or anything else missing', keywords: 'feature request suggest idea enhancement wish missing bank add support help feedback github' },
  { section: 'help', anchor: 'issue-browse', title: 'Browse existing issues', desc: 'See what is already reported before opening a new one', keywords: 'issues list open known existing browse github track status' },
];

const THEME_OPTIONS = [
  { id: 'system', label: 'System', sub: 'Follow your device', icon: <FiMonitor size={19} /> },
  { id: 'light', label: 'Light', sub: 'Bright surfaces', icon: <FiSun size={19} /> },
  { id: 'dark', label: 'Dark', sub: 'Dim surfaces', icon: <FiMoon size={19} /> },
];

const REMINDER_PRESETS = [3, 7, 14, 30];

/* The app keeps no issue tracker of its own — "raise an issue" is a deep link
   into the repo's new-issue form with the title, label and boilerplate already
   filled in, so the report arrives with the questions worth answering visible. */
const GITHUB_REPO = "https://github.com/arungdev/BankStatementAnalytics";

const ISSUE_TEMPLATES = {
  bug: {
    label: 'bug',
    title: '[Bug] ',
    body: [
      '**What happened**',
      '',
      '',
      '**What you expected instead**',
      '',
      '',
      '**Steps to reproduce**',
      '1. ',
      '2. ',
      '',
      '**Bank / statement involved** (if it is an import or parsing problem)',
      '',
    ],
  },
  feature: {
    label: 'enhancement',
    title: '[Feature] ',
    body: [
      '**What would you like to be able to do?**',
      '',
      '',
      '**Why it would help**',
      '',
    ],
  },
};

const newIssueUrl = (kind) => {
  const tpl = ISSUE_TEMPLATES[kind];
  const params = new URLSearchParams({
    labels: tpl.label,
    title: tpl.title,
    // Browser string goes in because import bugs are often renderer-specific;
    // nothing account-related is added — see the warning on the card.
    body: [...tpl.body, '', '---', `Browser: ${navigator.userAgent}`].join('\n'),
  });
  return `${GITHUB_REPO}/issues/new?${params}`;
};

/* Backup sizes come back as raw byte counts — shown in whatever unit keeps them readable. */
const formatBytes = (bytes) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
};

/**
 * SettingCard — the one shape every individual setting takes: a title, a plain
 * description of what it does, and its control on the right. Keeping every
 * setting in this frame is what makes the page scannable.
 */
function SettingCard({ anchor, icon, title, description, control, status, children, className = '' }) {
  return (
    <section id={anchor ? `set-${anchor}` : undefined} className={`setting-card ${className}`}>
      <div className="setting-card-head">
        {icon && <span className="setting-card-icon">{icon}</span>}
        <div className="setting-card-text">
          <h3 className="setting-card-title">
            {title}
            {status}
          </h3>
          {description && <p className="setting-card-desc">{description}</p>}
        </div>
        {control && <div className="setting-card-control">{control}</div>}
      </div>
      {children && <div className="setting-card-body">{children}</div>}
    </section>
  );
}

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
  const { maskAmounts, setMaskAmounts, maskNamesEnabled, setMaskNamesEnabled } = usePrivacy();
  const activeTab = searchParams.get('tab') || 'accounts';
  const setActiveTab = (tab) =>
    setSearchParams(tab === 'accounts' ? {} : { tab }, { replace: true });
  const [categories, setCategories] = useState([]);

  // Search across every setting (see SETTINGS_INDEX). While a query is typed the
  // panel is replaced by results, so one box covers the whole page.
  const [query, setQuery] = useState("");
  const searchRef = useRef(null);
  // Anchor of the card to scroll to + flash after jumping from a result.
  const [highlight, setHighlight] = useState(null);
  const navRef = useRef(null);

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
    const { name, error } = validateCategoryName(newCatName);
    if (error) { alert(error); return; }
    if (findExistingName(categories.map(c => c.name), name)) {
      alert(`A category named "${name}" already exists.`);
      return;
    }
    try {
      const res = await api.post("/categories", { name });
      setCategories([...categories, res.data]);
      setNewCatName("");
    } catch (err) {
      console.error(err);
      alert(err.response?.data || "Failed to add category. Please try again.");
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
    const { name, error } = validateCategoryName(editCatName);
    if (error) { alert(error); return; }
    if (findExistingName(categories.filter(c => c.id !== id).map(c => c.name), name)) {
      alert(`A category named "${name}" already exists.`);
      return;
    }
    try {
      await api.put(`/categories/${id}`, { name });
      setCategories(categories.map(c => c.id === id ? { ...c, name } : c));
      setEditingCatId(null);
    } catch (err) {
      console.error(err);
      alert(err.response?.data || "Failed to update category. Please try again.");
    }
  };

  const handleAddSubCategory = async (catId) => {
    const { name, error } = validateCategoryName(newSubCatName, "Sub-category");
    if (error) { alert(error); return; }
    const category = categories.find(c => c.id === catId);
    if (findExistingName(category?.subCategories, name)) {
      alert(`"${category.name}" already has a sub-category named "${name}".`);
      return;
    }
    try {
      await api.post(`/categories/${catId}/subcategories`, { name });
      setCategories(categories.map(c =>
        c.id === catId ? { ...c, subCategories: [...(c.subCategories || []), name] } : c
      ));
      setNewSubCatName("");
      setActiveSubCatInputId(null);
    } catch (err) {
      console.error(err);
      alert(err.response?.data || "Failed to add sub-category. Please try again.");
    }
  };

  // Deletes by name, not by index — the server identifies sub-categories by name,
  // so removing the matching name keeps the local list in step with what it did.
  const handleDeleteSubCategory = async (catId, subCatName) => {
    if (!window.confirm(`Delete sub-category "${subCatName}"?`)) return;
    try {
      await api.delete(`/categories/${catId}/subcategories/${encodeURIComponent(subCatName)}`);
      setCategories(categories.map(c => c.id === catId
        ? { ...c, subCategories: (c.subCategories || []).filter(s => s.toLowerCase() !== subCatName.toLowerCase()) }
        : c
      ));
    } catch (err) {
      console.error(err);
      alert(err.response?.data || "Failed to delete sub-category. Please try again.");
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

  /* ---- Backup & restore ---- */

  // Instance-wide and admin-only: a backup holds every user's data, and a restore replaces all
  // of it. Status is fetched lazily — only an admin who actually opens the section pays for it.
  const [backupStatus, setBackupStatus] = useState(null);
  const [downloadingBackup, setDownloadingBackup] = useState(false);
  const [restoreFile, setRestoreFile] = useState(null);
  const [restoreProgress, setRestoreProgress] = useState(0);
  const [restoring, setRestoring] = useState(false);
  const [backupError, setBackupError] = useState(null);
  const restoreInputRef = useRef(null);

  useEffect(() => {
    if (activeTab !== 'backup' || !isAdmin || backupStatus) return;
    getBackupStatus()
      .then(res => setBackupStatus(res.data))
      .catch(() => setBackupStatus({ supported: false, reason: 'Could not reach the server to check whether backup is available.' }));
  }, [activeTab, isAdmin, backupStatus]);

  const handleDownloadBackup = async () => {
    setDownloadingBackup(true);
    setBackupError(null);
    try {
      await downloadBackup();
    } catch (err) {
      console.error('Failed to download backup', err);
      setBackupError(await readApiError(err, 'Could not create the backup. Please try again.'));
    } finally {
      setDownloadingBackup(false);
    }
  };

  const handleRestore = async () => {
    if (!restoreFile) return;
    if (!window.confirm(
      `Restore from "${restoreFile.name}"?\n\n` +
      'This REPLACES every account, transaction, budget, bill and statement file in this app — ' +
      'for all users — with the contents of that backup. Anything added since it was taken is lost.\n\n' +
      'A copy of the current data is saved first, so this can be undone from the server if needed.'
    )) return;

    setRestoring(true);
    setRestoreProgress(0);
    setBackupError(null);
    try {
      await restoreBackup(restoreFile, (e) => {
        if (e.total) setRestoreProgress(Math.round((e.loaded / e.total) * 100));
      });
      // Everything on screen — accounts, categories, the selected account — came from the
      // database that was just replaced, so reload rather than try to re-sync it piecemeal.
      alert('Restore complete. The app will now reload.');
      window.location.reload();
    } catch (err) {
      console.error('Failed to restore backup', err);
      setBackupError(await readApiError(err, 'The restore failed. Your existing data was left in place.'));
      setRestoring(false);
    }
  };

  /* ---- Search ---- */

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return [];
    const terms = q.split(/\s+/);
    return SETTINGS_INDEX
      .filter(item => {
        const hay = `${item.title} ${item.desc} ${item.keywords} ${SECTIONS.find(s => s.id === item.section)?.label}`.toLowerCase();
        return terms.every(t => hay.includes(t));
      })
      // Title matches first — they're what people usually mean.
      .sort((a, b) => Number(b.title.toLowerCase().includes(terms[0])) - Number(a.title.toLowerCase().includes(terms[0])));
  }, [q]);

  const jumpTo = (item) => {
    setQuery("");
    setActiveTab(item.section);
    setHighlight(item.anchor);
  };

  // Scroll the jumped-to card into view and flash it, so the setting the user
  // picked from the results is obvious once the section opens. The class goes
  // on the node directly — the target card is rendered by whichever panel just
  // became active, so there's no single React-owned element to hang it off.
  // The card isn't there on the next frame: react-router wraps the tab change
  // in a transition, so we look for it over a few frames before giving up
  // (some anchors legitimately never render — e.g. card details with no card).
  useEffect(() => {
    if (!highlight) return;
    let el, raf, tries = 0;
    const find = () => {
      el = document.getElementById(`set-${highlight}`);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.classList.add('setting-flash');
      } else if (++tries < 30) {
        raf = requestAnimationFrame(find);
      }
    };
    raf = requestAnimationFrame(find);
    const timer = setTimeout(() => setHighlight(null), 2000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      el?.classList.remove('setting-flash');
    };
  }, [highlight]);

  // "/" focuses search from anywhere on the page (skipped while typing).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Roving arrow-key navigation over the section rail (expected of a tablist).
  const onNavKeyDown = (e) => {
    const keys = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    let next = null;
    if (keys[e.key]) {
      const i = SECTIONS.findIndex(s => s.id === activeTab);
      next = SECTIONS[(i + keys[e.key] + SECTIONS.length) % SECTIONS.length];
    } else if (e.key === 'Home') next = SECTIONS[0];
    else if (e.key === 'End') next = SECTIONS[SECTIONS.length - 1];
    if (!next) return;
    e.preventDefault();
    setActiveTab(next.id);
    navRef.current?.querySelector(`#tab-${next.id}`)?.focus();
  };

  /* ---- Live status shown on the rail, so state is visible without opening ---- */
  const navStatus = {
    accounts: accounts.length ? String(accounts.length) : null,
    categories: categories.length ? String(categories.length) : null,
    reminders: remEnabled ? 'On' : 'Off',
    privacy: maskAmounts ? 'Hiding' : null,
    appearance: THEME_OPTIONS.find(t => t.id === preference)?.label,
    profile: null,
    backup: isAdmin ? null : 'Admin',
    help: null,
  };

  const section = SECTIONS.find(s => s.id === activeTab) ?? SECTIONS[0];
  const cardAccounts = accounts.filter(a => a.bankName === 'HDFCCreditCard');

  /* ---- Panels ---- */

  const renderAppearance = () => (
    <div className="settings-stack">
      <SettingCard
        anchor="theme"
        icon={<FiSun size={18} />}
        title="Theme"
        description="Applies instantly and is remembered on this device."
      >
        <div className="choice-grid" role="radiogroup" aria-label="Theme">
          {THEME_OPTIONS.map(opt => (
            <button
              key={opt.id}
              role="radio"
              aria-checked={preference === opt.id}
              className={`choice-tile${preference === opt.id ? ' active' : ''}`}
              onClick={() => setPreference(opt.id)}
            >
              <span className="choice-tile-icon">{opt.icon}</span>
              <span className="choice-tile-label">{opt.label}</span>
              <span className="choice-tile-sub">{opt.sub}</span>
            </button>
          ))}
        </div>
      </SettingCard>

      <SettingCard
        anchor="text-size"
        icon={<FiType size={18} />}
        title="Text size"
        description="Scales all text across the app — useful if the default feels small."
      >
        <div className="choice-grid compact" role="radiogroup" aria-label="Text size">
          {FONT_SIZE_OPTIONS.map(opt => (
            <button
              key={opt.id}
              role="radio"
              aria-checked={fontSize === opt.id}
              className={`choice-tile center${fontSize === opt.id ? ' active' : ''}`}
              onClick={() => setFontSize(opt.id)}
            >
              <span className="choice-tile-preview" style={{ fontSize: `${opt.scale}em` }}>Aa</span>
              <span className="choice-tile-label">{opt.label}</span>
            </button>
          ))}
        </div>
      </SettingCard>
    </div>
  );

  const renderReminders = () => (
    <div className="settings-stack">
      <SettingCard
        anchor="reminders-enable"
        icon={<FiBell size={18} />}
        title="Desktop notifications"
        status={remEnabled ? <Badge variant="green">On</Badge> : null}
        description="Pops up a notification when a confirmed bill is due within your reminder window, and when a watch-folder statement fails to import. Notifications fire while the app is open."
        control={
          <>
            <button className="btn small" onClick={handleTestNotification}>Send test</button>
            <Switch
              checked={remEnabled}
              onChange={toggleReminders}
              label="Enable desktop notifications"
            />
          </>
        }
      >
        {notifPermission === 'denied' && (
          <p className="setting-note danger">
            <FiAlertCircle size={14} />
            Notifications are blocked in your browser. Allow them for this site (click the icon in the
            address bar), then turn this back on.
          </p>
        )}
        <p className="setting-note">
          Not seeing a toast? Turn off Focus assist / Do not disturb in Windows and make sure
          notifications are allowed for your browser — the toast may also be waiting in the Action Center.
        </p>
      </SettingCard>

      <SettingCard
        anchor="reminder-window"
        icon={<FiClock size={18} />}
        title="Reminder window"
        description="How many days ahead of the due date you want to be reminded."
      >
        <div className="segmented" role="group" aria-label="Reminder window presets">
          {REMINDER_PRESETS.map(d => (
            <button
              key={d}
              className={`segmented-option${remWindow === d ? ' active' : ''}`}
              aria-pressed={remWindow === d}
              onClick={() => updateWindow(d)}
            >
              {d} days
            </button>
          ))}
          <label className="segmented-custom">
            <span>Custom</span>
            <input
              type="number"
              min="1"
              max="31"
              value={remWindow}
              onChange={(e) => updateWindow(e.target.value)}
              className="field-input"
              aria-label="Reminder window in days"
            />
          </label>
        </div>
      </SettingCard>
    </div>
  );

  const renderPrivacy = () => (
    <div className="settings-stack">
      <SettingCard
        anchor="privacy-amounts"
        icon={<FiEyeOff size={18} />}
        title="Hide amounts"
        status={maskAmounts ? <Badge variant="green">On</Badge> : null}
        description="Masks every rupee value on screen. The eye icon in any page header flips this same switch."
        control={
          <Switch checked={maskAmounts} onChange={setMaskAmounts} label="Hide amounts" />
        }
      />

      <SettingCard
        anchor="privacy-names"
        icon={<FiLock size={18} />}
        title="Also hide merchant names"
        description={'Reduces merchant and bill names to their first letter (e.g. "S•••") across transactions, merchants, bills and insights.'}
        control={
          <Switch checked={maskNamesEnabled} onChange={setMaskNamesEnabled} label="Also hide merchant names" />
        }
      >
        {maskNamesEnabled && !maskAmounts && (
          <p className="setting-note">Takes effect as soon as “Hide amounts” is on.</p>
        )}
      </SettingCard>
    </div>
  );

  const renderHelp = () => (
    <div className="settings-stack">
      <SettingCard
        anchor="issue-bug"
        icon={<FiAlertCircle size={18} />}
        title="Report a problem"
        description="A statement that parsed wrong, a page that errored, a number that looks off — this opens a bug report with the details already laid out."
        control={
          <a className="btn primary small" href={newIssueUrl('bug')} target="_blank" rel="noopener noreferrer">
            <FiGithub size={15} /> Report a bug <FiExternalLink size={13} />
          </a>
        }
      >
        <p className="setting-note danger">
          <FiLock size={14} />
          Issues on GitHub are public. Strip account numbers, balances and merchant names out of
          anything you paste or screenshot — a redacted example still shows the problem.
        </p>
      </SettingCard>

      <SettingCard
        anchor="issue-feature"
        icon={<FiZap size={18} />}
        title="Suggest a feature"
        description="Missing a bank, a chart, or a way to slice your spending? Ask for it — feature requests go in the same place."
        control={
          <a className="btn small" href={newIssueUrl('feature')} target="_blank" rel="noopener noreferrer">
            <FiGithub size={15} /> Request a feature <FiExternalLink size={13} />
          </a>
        }
      />

      <SettingCard
        anchor="issue-browse"
        icon={<FiGithub size={18} />}
        title="Browse existing issues"
        description="Worth a look first — your problem may already be reported, and you can follow that one for updates instead of opening a duplicate."
        control={
          <a className="btn small" href={`${GITHUB_REPO}/issues`} target="_blank" rel="noopener noreferrer">
            Open on GitHub <FiExternalLink size={13} />
          </a>
        }
      />
    </div>
  );

  const renderBackup = () => {
    if (!isAdmin) {
      return (
        <div className="settings-empty">
          <FiLock size={36} />
          <div className="settings-empty-title">Only an admin can back up or restore</div>
          <div className="settings-empty-sub">
            A backup covers every user's data on this app, so it's kept to admins.
          </div>
        </div>
      );
    }

    const unsupported = backupStatus && !backupStatus.supported;

    return (
      <div className="settings-stack">
        {backupError && (
          <p className="setting-note danger">
            <FiAlertCircle size={14} />
            {backupError}
          </p>
        )}

        {unsupported && (
          <p className="setting-note danger">
            <FiAlertCircle size={14} />
            {backupStatus.reason}
          </p>
        )}

        <SettingCard
          anchor="backup-download"
          icon={<FiDownload size={18} />}
          title="Download a backup"
          description="One zip holding the whole database — every account, transaction, merchant, budget and bill, for all users — plus the original statement files you uploaded. Keep it somewhere safe; it is not encrypted."
          control={
            <button
              className="btn primary small"
              onClick={handleDownloadBackup}
              disabled={downloadingBackup || unsupported}
            >
              <FiDownload size={15} /> {downloadingBackup ? 'Preparing…' : 'Download backup'}
            </button>
          }
        >
          {backupStatus?.supported && (
            <p className="setting-note">
              Roughly {formatBytes(backupStatus.databaseBytes + backupStatus.uploadBytes)} —
              {' '}{formatBytes(backupStatus.databaseBytes)} of database
              {' '}plus {backupStatus.uploadFileCount} statement file{backupStatus.uploadFileCount === 1 ? '' : 's'}
              {' '}({formatBytes(backupStatus.uploadBytes)}). Large backups can take a minute to build.
            </p>
          )}
          {!backupStatus && <p className="setting-note">Checking what there is to back up…</p>}
        </SettingCard>

        <SettingCard
          anchor="backup-restore"
          icon={<FiUploadCloud size={18} />}
          title="Restore from a backup"
          status={<Badge variant="red">Replaces everything</Badge>}
          description="Loads a backup zip taken from this app. Everything currently here is replaced — this is not a merge."
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <input
              ref={restoreInputRef}
              type="file"
              accept=".zip,application/zip"
              disabled={restoring || unsupported}
              onChange={(e) => { setRestoreFile(e.target.files?.[0] ?? null); setBackupError(null); }}
              className="field-input"
              style={{ maxWidth: '320px' }}
              aria-label="Backup file to restore"
            />
            <button
              className="btn danger small"
              onClick={handleRestore}
              disabled={!restoreFile || restoring || unsupported}
            >
              <FiRotateCcw size={14} />
              {restoring
                ? (restoreProgress < 100 ? `Uploading ${restoreProgress}%…` : 'Restoring…')
                : 'Restore'}
            </button>
            {restoreFile && !restoring && (
              <button
                className="btn small"
                onClick={() => { setRestoreFile(null); if (restoreInputRef.current) restoreInputRef.current.value = ''; }}
              >
                Clear
              </button>
            )}
          </div>

          {restoreFile && (
            <p className="setting-note">
              {restoreFile.name} — {formatBytes(restoreFile.size)}
            </p>
          )}
          {/* Plain text only — .setting-note is a flex row (for the icon variant), so any real
              element in here becomes its own flex item and splits the paragraph into columns. */}
          <p className="setting-note">
            Before anything is overwritten, a copy of the current data is saved on the server under
            Data\Backups, so a restore from the wrong file can still be walked back. The app reloads
            once the restore finishes.
          </p>
        </SettingCard>
      </div>
    );
  };

  const renderAccounts = () => (
    accounts.length === 0 ? (
      <div className="settings-empty">
        <FiCreditCard size={36} />
        <div className="settings-empty-title">No accounts yet</div>
        <div className="settings-empty-sub">
          {isAdmin ? 'Click “Add account” to link your first bank account.' : 'No accounts have been added.'}
        </div>
      </div>
    ) : (
      <div className="settings-stack" id="set-accounts-list">
        {accounts.map((acc, i) => (
          <section key={acc.id} className="setting-card account-card">
            <div className="setting-card-head">
              <div className="account-identity">
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
                      aria-label="Account name"
                    />
                  ) : (
                    <h3 className="setting-card-title">{acc.accountHolderName || acc.bankName}</h3>
                  )}
                  <p className="setting-card-desc">
                    {acc.bankName} •••• {acc.accountNumber?.slice(-4) || '****'}
                    {acc.lastTransaction && <> · last txn {formatDate(acc.lastTransaction.date)}</>}
                  </p>
                </div>
              </div>

              {acc.balance != null && (
                <div className="account-balance">
                  <span className="account-balance-label">{acc.balanceLabel || 'Balance'}</span>
                  <span className="account-balance-value">{currencyFormatterFull.format(acc.balance)}</span>
                </div>
              )}

              {isAdmin && (
                <div className="setting-card-control">
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
                        <FiEdit2 size={13} /> Rename
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
              <div className="account-panel" id={acc.id === cardAccounts[0]?.id ? 'set-card-details' : undefined}>
                <div className="account-panel-head">
                  <div style={{ minWidth: 0 }}>
                    <h4 className="account-panel-title">Card details</h4>
                    <span className="account-panel-hint">Used for utilization and billing cycles</span>
                  </div>
                </div>
                <div className="settings-field-grid" style={{ marginTop: 'var(--space-4)' }}>
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
                  {cardAccounts.some(a => a.id !== acc.id) && (
                    <label className="settings-field lg">
                      <span className="settings-field-label">Shares limit with</span>
                      <select
                        value={cardDraft(acc).sharedLimitAccountId}
                        onChange={(e) => setCardDraft(acc.id, { sharedLimitAccountId: e.target.value })}
                        className="field-input"
                      >
                        <option value="">None (own limit)</option>
                        {cardAccounts.filter(a => a.id !== acc.id).map(a => (
                          <option key={a.id} value={a.id}>
                            •••• {a.accountNumber?.slice(-4) || a.id}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                {cardDrafts[acc.id] && (
                  <div className="account-panel-actions">
                    <button className="btn primary small" onClick={() => handleSaveCardSettings(acc)}>
                      Save card details
                    </button>
                    <button
                      className="btn small"
                      onClick={() => setCardDrafts(prev => { const n = { ...prev }; delete n[acc.id]; return n; })}
                    >
                      Discard
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Auto-import: a folder the backend sweeps ~once a minute,
                importing new statement files like a manual upload. The switch
                stays visible when collapsed so its state is always readable. */}
            {isAdmin && (
              <div className="account-panel" id={i === 0 ? 'set-auto-import' : undefined}>
                <div className="account-panel-head">
                  <div style={{ minWidth: 0 }}>
                    <h4 className="account-panel-title">
                      Auto-import
                      {acc.watchFolderPath && (acc.watchEnabled
                        ? <Badge variant="green">On</Badge>
                        : <Badge variant="amber">Paused</Badge>)}
                    </h4>
                    <span className="account-panel-hint">
                      {acc.watchFolderPath
                        ? acc.watchFolderPath
                        : 'Drop statements in a folder and they import themselves'}
                    </span>
                  </div>
                  <div className="account-panel-control">
                    {/* watchEnabled is null-means-enabled on the server, so it
                        reads true on a brand-new account — the watcher is only
                        really running once a folder is set. */}
                    <Switch
                      checked={!!acc.watchFolderPath && !!acc.watchEnabled}
                      disabled={!acc.watchFolderPath}
                      onChange={() => handleToggleAutoImport(acc)}
                      label={`Auto-import for ${acc.accountHolderName || acc.bankName}`}
                    />
                    <button
                      className="btn small ghost"
                      aria-expanded={!!autoOpen[acc.id]}
                      onClick={() => setAutoOpen(prev => ({ ...prev, [acc.id]: !prev[acc.id] }))}
                    >
                      {autoOpen[acc.id] ? <>Hide <FiChevronUp size={13} /></> : <>Set up <FiChevronDown size={13} /></>}
                    </button>
                  </div>
                </div>

                {autoOpen[acc.id] && (
                  <>
                    <div className="settings-field-grid" style={{ marginTop: 'var(--space-4)' }}>
                      <label className="settings-field grow">
                        <span className="settings-field-label">Folder to watch</span>
                        <input
                          type="text"
                          placeholder="e.g. D:\Statements\HDFC"
                          value={autoDraft(acc).watchFolderPath}
                          onChange={(e) => setAutoDraft(acc.id, { watchFolderPath: e.target.value })}
                          className="field-input"
                        />
                      </label>
                      <button type="button" className="btn small" onClick={() => openBrowse(acc)}>
                        <FiFolder size={13} /> Browse…
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
                            aria-label={showPw[acc.id] ? "Hide password" : "Show password"}
                            onClick={() => setShowPw(prev => ({ ...prev, [acc.id]: !prev[acc.id] }))}
                          >
                            {showPw[acc.id] ? <FiEyeOff size={14} /> : <FiEye size={14} />}
                          </button>
                        </span>
                      </label>
                    </div>

                    <div className="account-panel-actions">
                      {autoDrafts[acc.id] && (
                        <button className="btn primary small" onClick={() => handleSaveAutoImport(acc)}>
                          Save
                        </button>
                      )}
                      {acc.watchFolderPath && acc.watchEnabled && !autoDrafts[acc.id] && (
                        <button
                          type="button"
                          className="btn small"
                          disabled={!!sweeping[acc.id]}
                          onClick={() => handleImportNow(acc)}
                        >
                          <FiDownloadCloud size={13} />
                          {sweeping[acc.id] ? 'Checking folder…' : 'Import now'}
                        </button>
                      )}
                      {acc.watchFolderPath && (
                        <button type="button" className="btn small" onClick={() => openHistory(acc)}>
                          <FiClock size={13} /> History
                        </button>
                      )}
                      {acc.hasStatementPassword && (
                        <button className="btn small ghost" onClick={() => handleSaveAutoImport(acc, { clearPassword: true })}>
                          Clear saved password
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

                    <p className="setting-note">
                      New statement files land in your transactions about a minute after they appear in this
                      folder. The password is stored on this computer and used to open protected PDFs.
                      Tip: in Explorer, right-click a folder → “Copy as path” and paste it here.
                    </p>
                  </>
                )}
              </div>
            )}
          </section>
        ))}
      </div>
    )
  );

  const renderCategories = () => (
    <>
      {isAdmin && (
        <div className="settings-add-card">
          <label className="settings-add-card-label" htmlFor="new-category">Add a new category</label>
          <div className="settings-add-row">
            <input
              id="new-category"
              type="text"
              placeholder="e.g. Groceries, Rent, Travel…"
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddCategory(); }}
              maxLength={CATEGORY_NAME_MAX}
              className="field-input"
              style={{ flex: 1 }}
            />
            <button className="btn primary" style={{ whiteSpace: 'nowrap' }} onClick={handleAddCategory}>
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
        <div className="settings-stack" id="set-categories-list">
          {categories.map(cat => (
            <section key={cat.id} className="setting-card">
              <div className="setting-card-head">
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
                      maxLength={CATEGORY_NAME_MAX}
                      autoFocus
                      className="field-input"
                      style={{ flex: 1 }}
                      aria-label="Category name"
                    />
                    <button className="btn primary small" onClick={() => handleUpdateCategory(cat.id)}>Save</button>
                    <button className="btn small" onClick={() => setEditingCatId(null)}>Cancel</button>
                  </div>
                ) : (
                  <>
                    <div className="setting-card-text">
                      <h3 className="setting-card-title">
                        {cat.name}
                        {isAdmin && (
                          <button
                            className="settings-edit-link"
                            title="Rename category"
                            aria-label={`Rename ${cat.name}`}
                            onClick={() => { setEditingCatId(cat.id); setEditCatName(cat.name); }}
                          >
                            <FiEdit2 size={14} />
                          </button>
                        )}
                      </h3>
                      <p className="setting-card-desc">
                        {(cat.subCategories || []).length || 'No'} sub-categor
                        {(cat.subCategories || []).length === 1 ? 'y' : 'ies'}
                      </p>
                    </div>
                    {isAdmin && (
                      <div className="setting-card-control">
                        <button className="btn danger small" onClick={() => handleDeleteCategory(cat.id, cat.name)}>Delete</button>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="setting-card-body subcat-section">
                <div className="subcat-chips">
                  {(cat.subCategories || []).map((sub, idx) => (
                    <span key={idx} className="subcat-chip">
                      {sub}
                      {isAdmin && (
                        <button
                          className="subcat-chip-remove"
                          onClick={() => handleDeleteSubCategory(cat.id, sub)}
                          title={`Remove ${sub}`}
                          aria-label={`Remove ${sub}`}
                        >
                          <FiX size={13} />
                        </button>
                      )}
                    </span>
                  ))}

                  {isAdmin && (activeSubCatInputId === cat.id ? (
                    <span className="subcat-add-row">
                      <input
                        type="text"
                        placeholder="New sub-category"
                        value={newSubCatName}
                        onChange={(e) => setNewSubCatName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleAddSubCategory(cat.id);
                          if (e.key === 'Escape') { e.stopPropagation(); setActiveSubCatInputId(null); }
                        }}
                        maxLength={CATEGORY_NAME_MAX}
                        autoFocus
                        className="field-input"
                        aria-label="New sub-category"
                      />
                      <button className="btn primary small" onClick={() => handleAddSubCategory(cat.id)}>Add</button>
                      <button className="btn small" onClick={() => setActiveSubCatInputId(null)}>Cancel</button>
                    </span>
                  ) : (
                    <button
                      className="subcat-add-btn"
                      onClick={() => { setActiveSubCatInputId(cat.id); setNewSubCatName(""); }}
                    >
                      <FiPlus size={13} /> Add sub-category
                    </button>
                  ))}

                  {(cat.subCategories || []).length === 0 && activeSubCatInputId !== cat.id && !isAdmin && (
                    <span className="subcat-empty">None yet</span>
                  )}
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );

  return (
    <div className="settings-page">
      <div className="settings-shell">
        {/* ── Section rail: search + all sections visible at once ── */}
        <aside className="settings-rail">
          <div className="settings-search">
            <FiSearch size={15} className="settings-search-icon" />
            <input
              ref={searchRef}
              type="search"
              className="settings-search-input"
              placeholder="Search settings…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.stopPropagation(); setQuery(""); }
                if (e.key === 'Enter' && results.length) jumpTo(results[0]);
              }}
              aria-label="Search settings"
            />
            {query
              ? (
                <button className="settings-search-clear" onClick={() => setQuery("")} aria-label="Clear search">
                  <FiX size={14} />
                </button>
              )
              : <kbd className="settings-search-kbd">/</kbd>}
          </div>

          <nav
            ref={navRef}
            className="settings-nav"
            role="tablist"
            aria-orientation="vertical"
            aria-label="Settings sections"
            onKeyDown={onNavKeyDown}
          >
            {SECTIONS.map(s => (
              <button
                key={s.id}
                id={`tab-${s.id}`}
                role="tab"
                aria-selected={activeTab === s.id}
                aria-controls="settings-panel"
                tabIndex={activeTab === s.id ? 0 : -1}
                className={`settings-nav-item${activeTab === s.id ? ' active' : ''}`}
                onClick={() => { setQuery(""); setActiveTab(s.id); }}
              >
                <span className="settings-nav-icon">{s.icon}</span>
                <span className="settings-nav-text">
                  <span className="settings-nav-label">{s.label}</span>
                  <span className="settings-nav-hint">{s.hint}</span>
                </span>
                {navStatus[s.id] && <span className="settings-nav-status">{navStatus[s.id]}</span>}
              </button>
            ))}
          </nav>
        </aside>

        {/* ── Panel: search results, or the active section ── */}
        <div
          className="settings-panel"
          id="settings-panel"
          role="tabpanel"
          aria-labelledby={`tab-${activeTab}`}
          tabIndex={-1}
        >
          {q ? (
            <>
              <header className="settings-panel-head">
                <div>
                  <h1 className="settings-panel-title">
                    {results.length} result{results.length === 1 ? '' : 's'} for “{query.trim()}”
                  </h1>
                  <p className="settings-panel-sub">
                    {results.length ? 'Press Enter to open the first result.' : 'Try a word like theme, password, folder, or reminder.'}
                  </p>
                </div>
              </header>
              <div className="settings-panel-body">
                {results.length === 0 ? (
                  <div className="settings-empty">
                    <FiSearch size={32} />
                    <div className="settings-empty-title">Nothing matched “{query.trim()}”</div>
                    <div className="settings-empty-sub">Search covers every setting on this page.</div>
                  </div>
                ) : (
                  <div className="search-results">
                    {results.map((item, i) => (
                      <button key={`${item.section}-${item.title}`} className="search-result" onClick={() => jumpTo(item)}>
                        <span className="search-result-icon">
                          {SECTIONS.find(s => s.id === item.section)?.icon}
                        </span>
                        <span className="search-result-text">
                          <span className="search-result-title">{item.title}</span>
                          <span className="search-result-desc">{item.desc}</span>
                        </span>
                        <span className="search-result-section">
                          {SECTIONS.find(s => s.id === item.section)?.label}
                        </span>
                        {i === 0 && <FiCornerDownLeft size={14} className="search-result-enter" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <header className="settings-panel-head">
                <div className="settings-panel-head-text">
                  <h1 className="settings-panel-title">{section.title}</h1>
                  <p className="settings-panel-sub">{section.subtitle}</p>
                </div>
                {activeTab === 'accounts' && isAdmin && (
                  <button className="btn primary small" onClick={() => openAddAccount?.()}>
                    <FiPlus size={15} /> Add account
                  </button>
                )}
                {activeTab === 'categories' && (
                  <button className="btn small" onClick={fetchCategories} title="Reload categories">
                    <FiRefreshCw size={14} /> Refresh
                  </button>
                )}
              </header>

              <div className="settings-panel-body">
                {activeTab === 'accounts' && renderAccounts()}
                {activeTab === 'categories' && renderCategories()}
                {activeTab === 'reminders' && renderReminders()}
                {activeTab === 'privacy' && renderPrivacy()}
                {activeTab === 'appearance' && renderAppearance()}
                {activeTab === 'profile' && <div id="set-profile-account"><ProfileSettings /></div>}
                {activeTab === 'backup' && renderBackup()}
                {activeTab === 'help' && renderHelp()}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Auto-import history — RHS drawer for one account's watch-folder runs */}
      <Drawer
        open={!!historyAcc}
        onClose={() => setHistoryAcc(null)}
        title={`Auto-import history${historyAcc ? ` — ${historyAcc.accountHolderName || historyAcc.bankName}` : ''}`}
        width={historyWidth}
        onWidthChange={setHistoryWidth}
        modal={false}
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
