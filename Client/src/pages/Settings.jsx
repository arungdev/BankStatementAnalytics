import { canEditWorkspace } from '../utils/workspacePermissions';
import useAuthenticationOptions from '../hooks/useAuthenticationOptions';
import AppearanceSettings from "../components/settings/AppearanceSettings";
import ReminderSettings from "../components/settings/ReminderSettings";
import PrivacySettings from "../components/settings/PrivacySettings";
import HelpSettings from "../components/settings/HelpSettings";
import BackupSettings from "../components/settings/BackupSettings";
import UpdateSettings from "../components/settings/UpdateSettings";
import AccountSettings from "../components/settings/AccountSettings";
import CategorySettings from "../components/settings/CategorySettings";
import TagSettings from "../components/settings/TagSettings";
import { useState, useEffect, useMemo, useRef } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { FiCreditCard, FiTag, FiBookmark, FiUser, FiPlus, FiX, FiBell, FiSun, FiMoon, FiMonitor, FiEyeOff, FiRotateCcw, FiAlertCircle, FiCheckCircle, FiSearch, FiCornerDownLeft, FiRefreshCw, FiDatabase, FiHelpCircle, FiZap, FiWifi, FiUserCheck } from "react-icons/fi";
import api from "../api/client";
import { updateCardSettings } from "../api/cards";
import { updateAutoImport, browseFolders } from "../api/accounts";
import { getGPayAutoImportConfig, updateGPayAutoImportConfig, triggerGPayAutoImportSweep, getParticipantSuggestions } from "../api/splits";
import { validateCategoryName, findExistingName } from "../utils/categoryName";
import { triggerAutoImportSweep, getAutoImports, retryAutoImport } from "../api/statements";
import { useAccount } from "../context/useAccount";
import { Badge, Drawer, useAuth, useTheme, Modal } from "@common/client";
import { usePrivacy } from "../context/usePrivacy";
import ProfileSettings from "../components/ProfileSettings";

import NetworkSettings from "../components/NetworkSettings";
import ConfirmDialog from "../components/ConfirmDialog";
import RulesManager from "../components/RulesManager";
import { getBackupStatus, downloadBackup, restoreBackup, readApiError } from "../api/backup";
import { getUpdateStatus, getUpdateInstallation, checkForUpdates, downloadUpdate, cancelDownload, applyUpdate, downloadUpdateBinary } from "../api/update";
import { getUpdateOutcome, isInstallingUpdate } from "../utils/updateProgress";
import { REMINDERS_ENABLED_KEY, REMINDER_WINDOW_KEY, sendTestNotification } from "../hooks/useBillReminders";

import "./Settings.css";

/* Section groupings for organized navigation */
const SECTION_GROUPS = [
  { id: 'finance', label: 'Finance & Data' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'system', label: 'System & Security' },
  { id: 'support', label: 'Help & Support' },
];

/* Sections of the settings page, in rail order. `hint` is the one-line
   "what lives here" shown under the label so a section can be picked without
   opening it first. */
const SECTIONS = [
  { id: 'accounts', group: 'finance', label: 'Accounts', hint: 'Banks, cards & auto-import', icon: <FiCreditCard size={17} />, title: 'Accounts', subtitle: 'Your linked bank accounts, card details, and automatic statement imports.' },
  { id: 'categories', group: 'finance', label: 'Categories', hint: 'How spending is grouped', icon: <FiTag size={17} />, title: 'Categories', subtitle: 'Organize your spending into categories and sub-categories.' },
  { id: 'tags', group: 'finance', label: 'Tags', hint: 'Labels & transaction flags', icon: <FiBookmark size={17} />, title: 'Tags', subtitle: 'Manage tags used to label and filter your transactions.' },
  { id: 'rules', group: 'finance', label: 'Rules', hint: 'Auto-categorization & tagging', icon: <FiZap size={17} />, title: 'Categorization Rules', subtitle: 'Automatically categorize, tag, and annotate transactions on import.' },
  { id: 'reminders', group: 'preferences', label: 'Reminders', hint: 'Bill due alerts', icon: <FiBell size={17} />, title: 'Bill reminders', subtitle: 'Get a desktop notification when a recurring bill is due soon.' },
  { id: 'privacy', group: 'preferences', label: 'Privacy', hint: 'What the eye icon hides', icon: <FiEyeOff size={17} />, title: 'Privacy', subtitle: 'Control what is hidden on screen when someone is looking over your shoulder.' },
  { id: 'appearance', group: 'preferences', label: 'Appearance', hint: 'Theme & text size', icon: <FiSun size={17} />, title: 'Appearance', subtitle: 'Choose how the app looks on this device.' },
  { id: 'network', group: 'system', label: 'Network', hint: 'Access from phone & LAN', icon: <FiWifi size={17} />, title: 'Local Network Access', subtitle: 'Allow or block access from other phones, tablets, or computers on your Wi-Fi network.' },
  { id: 'profile', group: 'system', label: 'Profile', hint: 'Login & users', icon: <FiUser size={17} />, title: 'Profile', subtitle: 'Manage your login and, as an admin, the other users on this app.' },
  { id: 'backup', group: 'system', label: 'Backup', hint: 'Save & restore everything', icon: <FiDatabase size={17} />, title: 'Backup & restore', subtitle: 'Save a copy of everything in this app, and put it back later or on another machine.' },
  { id: 'updates', group: 'system', label: 'Updates', hint: 'Version & software update', icon: <FiRefreshCw size={17} />, title: 'Software updates', subtitle: 'Check for new releases, view changelogs, and upgrade your installation.' },
  { id: 'help', group: 'support', label: 'Help', hint: 'Report a problem', icon: <FiHelpCircle size={17} />, title: 'Help & feedback', subtitle: 'Hit a bug, or want something the app does not do yet? Raise it on GitHub — every link here opens in a new tab.' },
];

/* Flat index of every individual setting, so the search box can take you
   straight to one instead of making you guess which tab it lives under.
   `anchor` is the id of the card to scroll to and flash (may not be rendered —
   e.g. card details only exist when a credit card account is present — in
   which case we just open the section). */
const SETTINGS_INDEX = [
  { section: 'accounts', anchor: 'accounts-list', title: 'Bank accounts', desc: 'Rename, check the balance, or remove an account', keywords: 'account bank rename delete remove balance holder name number linked add' },
  { section: 'accounts', anchor: 'accounts-list', title: 'Manual import & upload history', desc: 'Upload a statement and review imported or failed files for an account', keywords: 'manual import upload statement history file pdf csv txt revert retry failed' },
  { section: 'accounts', anchor: 'auto-import', title: 'Auto-import folder', desc: 'Watch a folder and import new statements automatically', keywords: 'auto import automatic watch folder statement pdf password protected browse import now history retry failed' },
  { section: 'accounts', anchor: 'card-details', title: 'Credit limit & statement day', desc: 'Card details used for utilization and billing cycles', keywords: 'credit card limit utilization statement day billing cycle shared limit add-on' },
  { section: 'categories', anchor: 'categories-list', title: 'Categories & sub-categories', desc: 'Add, rename, or delete spending categories', keywords: 'category categories sub-category subcategory spending group tag rename delete add' },
  { section: 'tags', anchor: 'tags-list', title: 'Tags', desc: 'Add, rename, or delete transaction tags', keywords: 'tag tags label flags marker rename delete add remove' },
  { section: 'rules', anchor: 'rules-list', title: 'Categorization rules', desc: 'Automatically categorize, tag, and annotate transactions on import', keywords: 'rules rule categorize condition match pattern keyword tag auto override annotate regex' },
  { section: 'reminders', anchor: 'reminders-enable', title: 'Desktop notifications', desc: 'Turn bill reminders on and send a test notification', keywords: 'notification desktop reminder alert toast bill due test enable permission blocked' },
  { section: 'reminders', anchor: 'reminder-window', title: 'Reminder window', desc: 'How many days before a bill is due to remind you', keywords: 'reminder window days before due lead time' },
  { section: 'privacy', anchor: 'privacy-amounts', title: 'Hide amounts', desc: 'Mask every rupee value on screen', keywords: 'privacy hide amount mask money rupee blur eye incognito shoulder' },
  { section: 'privacy', anchor: 'privacy-names', title: 'Hide merchant names', desc: 'Also mask merchant and bill names while hiding is on', keywords: 'privacy hide merchant name payee bill mask anonymize' },
  { section: 'appearance', anchor: 'theme', title: 'Theme', desc: 'Light, dark, or follow your device', keywords: 'theme dark light system appearance colour color night mode' },
  { section: 'appearance', anchor: 'text-size', title: 'Text size', desc: 'Scale all text in the app', keywords: 'text size font bigger smaller zoom scale accessibility readable' },
  { section: 'network', anchor: 'network-access', title: 'Local network access', desc: 'Enable or disable accessing the app from other devices on the same Wi-Fi', keywords: 'network wifi lan ip remote device phone tablet mobile connect address host' },
  { section: 'profile', anchor: 'profile-account', title: 'Your login', desc: 'Signed-in user and role', keywords: 'profile username role admin signed in login account' },
  { section: 'profile', anchor: 'profile-account', title: 'Change password', desc: 'Set a new password for your login', keywords: 'change password reset credentials security login' },
  { section: 'profile', anchor: 'profile-users', title: 'Users', desc: 'Add, disable, or delete other users', keywords: 'user users add create disable delete role admin permission access' },
  { section: 'backup', anchor: 'backup-download', title: 'Download a backup', desc: 'Save every account, transaction and statement file to one zip', keywords: 'backup download save export zip copy archive data safety disaster move machine' },
  { section: 'backup', anchor: 'backup-restore', title: 'Restore from a backup', desc: 'Replace everything in this app with the contents of a backup', keywords: 'restore import upload recover revert replace rollback zip backup migrate' },
  { section: 'updates', anchor: 'updates-check', title: 'Check for updates', desc: 'Check GitHub releases for the latest version and release notes', keywords: 'update version upgrade release notes changelog download install patch new auto update' },
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
  const { isAdmin, role } = useAuth();
  const canEdit = canEditWorkspace(role);
  const authenticationOptions = useAuthenticationOptions();
  const canManageServer = isAdmin && !authenticationOptions.cloudGoogleOnly;
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

  // Shared confirm dialog (replaces window.confirm) — { title, message, confirmLabel,
  // danger, onConfirm } or null when closed. `onConfirm` may be async; the dialog
  // shows a busy state and stays open until it resolves.
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const closeConfirm = () => { if (!confirmBusy) setConfirmDialog(null); };
  const runConfirm = async () => {
    if (!confirmDialog) return;
    setConfirmBusy(true);
    try {
      await confirmDialog.onConfirm();
      setConfirmDialog(null);
    } finally {
      setConfirmBusy(false);
    }
  };

  // Category states
  const [newCatName, setNewCatName] = useState("");
  const [newCatNameError, setNewCatNameError] = useState("");
  const [editingCatId, setEditingCatId] = useState(null);
  const [editCatName, setEditCatName] = useState("");
  const [editCatNameError, setEditCatNameError] = useState("");

  // Sub-category states
  const [newSubCatName, setNewSubCatName] = useState("");
  const [newSubCatNameError, setNewSubCatNameError] = useState("");
  const [activeSubCatInputId, setActiveSubCatInputId] = useState(null);

  // Tag states
  const [tags, setTags] = useState([]);
  const [newTagName, setNewTagName] = useState("");
  const [newTagError, setNewTagError] = useState("");
  const [editingTagId, setEditingTagId] = useState(null);
  const [editTagName, setEditTagName] = useState("");
  const [editTagNameError, setEditTagNameError] = useState("");

  // Account states
  const [editingAccountId, setEditingAccountId] = useState(null);
  const [editAccountName, setEditAccountName] = useState("");

  // Credit-card metadata drafts (credit limit / statement day), keyed by account id.
  // Values usually come parsed from the PDF statement; these fields are the manual fallback.
  const [cardDrafts, setCardDrafts] = useState({});
  const cardDraft = (acc) => ({
    creditLimit: acc.creditLimit ?? "",
    statementDay: acc.statementDay ?? "",
    sharedLimitAccountId: acc.sharedLimitAccountId ?? "",
    ...(cardDrafts[acc.id] ?? {}),
  });
  const setCardDraft = (id, patch) =>
    setCardDrafts(prev => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...patch } }));

  const handleSaveCardSettings = async (acc) => {
    const d = cardDraft(acc);
    const body = {
      creditLimit: d.creditLimit === "" || d.creditLimit == null ? null : Number(d.creditLimit),
      statementDay: d.statementDay === "" || d.statementDay == null ? null : Number(d.statementDay),
      sharedLimitAccountId: d.sharedLimitAccountId === "" || d.sharedLimitAccountId == null ? null : Number(d.sharedLimitAccountId),
    };
    if (body.statementDay != null && (isNaN(body.statementDay) || body.statementDay < 1 || body.statementDay > 31)) {
      alert("Statement day must be between 1 and 31.");
      return;
    }
    if (body.creditLimit != null && (isNaN(body.creditLimit) || body.creditLimit < 0)) {
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

  // Google Pay Auto-import state & handlers
  const [gpayConfig, setGpayConfig] = useState(null);
  const [gpayAutoOpen, setGpayAutoOpen] = useState(false);
  const [gpayDraftPath, setGpayDraftPath] = useState('');
  const [gpaySweeping, setGpaySweeping] = useState(false);
  const [gpayMessage, setGpayMessage] = useState(null);
  const [splitDisplayFilter, setSplitDisplayFilter] = useState(
    () => localStorage.getItem('bsp_gpay_split_filter') || 'all'
  );
  const [onlyLinkCreatedByMe, setOnlyLinkCreatedByMe] = useState(
    () => localStorage.getItem('bsp_gpay_only_link_created_by_me') !== 'false'
  );
  const [gpayUserName, setGpayUserName] = useState(
    () => localStorage.getItem('bsp_gpay_user_name') || ''
  );
  const [namePickerOpen, setNamePickerOpen] = useState(false);
  const [namePickerSearch, setNamePickerSearch] = useState('');
  const [participantList, setParticipantList] = useState([]);
  const [loadingParticipants, setLoadingParticipants] = useState(false);

  useEffect(() => {
    getGPayAutoImportConfig().then(res => {
      setGpayConfig(res.data);
      setGpayDraftPath(res.data?.watchFolderPath || 'D:\\BankStatements\\Gpay');
      if (res.data?.userName) {
        setGpayUserName(res.data.userName);
        localStorage.setItem('bsp_gpay_user_name', res.data.userName);
      }
    }).catch(() => {});
  }, []);

  const handleSaveGPayUserName = async (val) => {
    const trimmed = (val || '').trim();
    setGpayUserName(trimmed);
    if (!gpayConfig?.profileId) localStorage.setItem('bsp_gpay_user_name', trimmed);
    try {
      const res = await updateGPayAutoImportConfig({ userName: trimmed }, gpayConfig?.profileId);
      setGpayConfig(res.data);
    } catch (err) {
      console.error("Failed to update split user name", err);
    }
  };

  const handleOpenNamePicker = async () => {
    setNamePickerOpen(true);
    setNamePickerSearch('');
    if (participantList.length === 0) {
      setLoadingParticipants(true);
      try {
        const res = await getParticipantSuggestions();
        setParticipantList(res.data || []);
      } catch (err) {
        console.error("Failed to load participant suggestions", err);
      } finally {
        setLoadingParticipants(false);
      }
    }
  };

  const handleSelectCandidateName = (name) => {
    handleSaveGPayUserName(name);
    setNamePickerOpen(false);
  };

  const handleToggleGPayAutoImport = async () => {
    try {
      const next = !gpayConfig?.watchEnabled;
      const res = await updateGPayAutoImportConfig({ watchEnabled: next }, gpayConfig?.profileId);
      setGpayConfig(res.data);
    } catch (err) {
      console.error("Failed to toggle Google Pay auto-import", err);
      alert("Failed to update Google Pay auto-import.");
    }
  };

  const handleSaveGPayAutoImport = async () => {
    try {
      const res = await updateGPayAutoImportConfig({
        watchFolderPath: gpayDraftPath.trim(),
        watchEnabled: true
      }, gpayConfig?.profileId);
      setGpayConfig(res.data);
      setGpayMessage("Google Pay auto-import settings saved.");
      setTimeout(() => setGpayMessage(null), 4000);
    } catch (err) {
      console.error("Failed to save Google Pay auto-import", err);
      alert(err.response?.data?.message || "Failed to update Google Pay auto-import.");
    }
  };

  const handleSweepGPay = async () => {
    setGpaySweeping(true);
    setGpayMessage(null);
    try {
      const res = await triggerGPayAutoImportSweep(gpayConfig?.profileId);
      setGpayMessage(res.data.message || "Google Pay sweep complete.");
      const c = await getGPayAutoImportConfig(gpayConfig?.profileId);
      setGpayConfig(c.data);
      setTimeout(() => setGpayMessage(null), 5000);
    } catch (err) {
      console.error("Failed to sweep Google Pay", err);
      setGpayMessage(err.response?.data?.message || "Failed to sweep Google Pay.");
    } finally {
      setGpaySweeping(false);
    }
  };

  const openBrowseGPay = async () => {
    try {
      const res = await browseFolders(gpayDraftPath?.trim() || undefined);
      setBrowse({ accId: 'gpay', ...res.data, error: null });
    } catch {
      try {
        const res = await browseFolders();
        setBrowse({ accId: 'gpay', ...res.data, error: null });
      } catch {
        alert("Could not open the folder browser.");
      }
    }
  };
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

  const fetchTags = async () => {
    try {
      const res = await api.get("/tags");
      setTags(res.data || []);
    } catch (err) {
      console.error("Failed to load tags", err);
    }
  };

  const [rulesCount, setRulesCount] = useState(null);
  const fetchRulesCount = async () => {
    try {
      const res = await api.get("/rules");
      setRulesCount(Array.isArray(res.data) ? res.data.length : null);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchCategories();
    fetchTags();
    fetchRulesCount();
  }, []);

  const handleAddCategory = async () => {
    const { name, error } = validateCategoryName(newCatName);
    if (error) { setNewCatNameError(error); return; }
    if (findExistingName(categories.map(c => c.name), name)) {
      setNewCatNameError(`A category named "${name}" already exists.`);
      return;
    }
    setNewCatNameError("");
    try {
      const res = await api.post("/categories", { name });
      setCategories([...categories, res.data]);
      setNewCatName("");
    } catch (err) {
      console.error(err);
      setNewCatNameError(err.response?.data || "Failed to add category. Please try again.");
    }
  };

  const handleDeleteCategory = (id, name) => {
    setConfirmDialog({
      title: "Delete category?",
      message: `Delete category "${name}"? Transactions using it will become uncategorized.`,
      confirmLabel: "Delete",
      danger: true,
      onConfirm: async () => {
        try {
          await api.delete(`/categories/${id}`);
          setCategories(categories.filter(c => c.id !== id));
        } catch (err) {
          console.error(err);
          alert("Failed to delete category. Please try again.");
        }
      },
    });
  };

  const handleUpdateCategory = async (id) => {
    const { name, error } = validateCategoryName(editCatName);
    if (error) { setEditCatNameError(error); return; }
    if (findExistingName(categories.filter(c => c.id !== id).map(c => c.name), name)) {
      setEditCatNameError(`A category named "${name}" already exists.`);
      return;
    }
    setEditCatNameError("");
    try {
      await api.put(`/categories/${id}`, { name });
      setCategories(categories.map(c => c.id === id ? { ...c, name } : c));
      setEditingCatId(null);
    } catch (err) {
      console.error(err);
      setEditCatNameError(err.response?.data || "Failed to update category. Please try again.");
    }
  };

  const handleAddSubCategory = async (catId) => {
    const { name, error } = validateCategoryName(newSubCatName, "Sub-category");
    if (error) { setNewSubCatNameError(error); return; }
    const category = categories.find(c => c.id === catId);
    if (findExistingName(category?.subCategories, name)) {
      setNewSubCatNameError(`"${category.name}" already has a sub-category named "${name}".`);
      return;
    }
    setNewSubCatNameError("");
    try {
      await api.post(`/categories/${catId}/subcategories`, { name });
      setCategories(categories.map(c =>
        c.id === catId ? { ...c, subCategories: [...(c.subCategories || []), name] } : c
      ));
      setNewSubCatName("");
      setActiveSubCatInputId(null);
    } catch (err) {
      console.error(err);
      setNewSubCatNameError(err.response?.data || "Failed to add sub-category. Please try again.");
    }
  };

  // Deletes by name, not by index — the server identifies sub-categories by name,
  // so removing the matching name keeps the local list in step with what it did.
  const handleDeleteSubCategory = (catId, subCatName) => {
    setConfirmDialog({
      title: "Delete sub-category?",
      message: `Delete sub-category "${subCatName}"?`,
      confirmLabel: "Delete",
      danger: true,
      onConfirm: async () => {
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
      },
    });
  };

  const cleanTagName = (val) => {
    let s = (val || "").trim();
    if (s.startsWith("#")) s = s.slice(1).trim();
    return s;
  };

  const handleAddTag = async () => {
    const name = cleanTagName(newTagName);
    if (!name) {
      setNewTagError("Tag name is required.");
      return;
    }
    if (name.length > 50) {
      setNewTagError("Tag name can be at most 50 characters.");
      return;
    }
    if (tags.some(t => t.name.toLowerCase() === name.toLowerCase())) {
      setNewTagError(`A tag named "${name}" already exists.`);
      return;
    }
    setNewTagError("");
    try {
      const res = await api.post("/tags", { name });
      setTags(prev => [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)));
      setNewTagName("");
    } catch (err) {
      console.error("Failed to add tag", err);
      setNewTagError(err.response?.data || "Failed to add tag. Please try again.");
    }
  };

  const handleUpdateTag = async (id) => {
    const name = cleanTagName(editTagName);
    if (!name) {
      setEditTagNameError("Tag name is required.");
      return;
    }
    if (name.length > 50) {
      setEditTagNameError("Tag name can be at most 50 characters.");
      return;
    }
    if (tags.some(t => t.id !== id && t.name.toLowerCase() === name.toLowerCase())) {
      setEditTagNameError(`A tag named "${name}" already exists.`);
      return;
    }
    setEditTagNameError("");
    try {
      await api.put(`/tags/${id}`, { name });
      setTags(prev => prev.map(t => t.id === id ? { ...t, name } : t).sort((a, b) => a.name.localeCompare(b.name)));
      setEditingTagId(null);
    } catch (err) {
      console.error("Failed to update tag", err);
      setEditTagNameError(err.response?.data || "Failed to update tag. Please try again.");
    }
  };

  const handleDeleteTag = (id, name, usageCount) => {
    setConfirmDialog({
      title: "Delete tag?",
      message: `Delete tag "#${name}"? It will be removed from ${usageCount || 0} transaction${usageCount === 1 ? '' : 's'}.`,
      confirmLabel: "Delete",
      danger: true,
      onConfirm: async () => {
        try {
          await api.delete(`/tags/${id}`);
          setTags(prev => prev.filter(t => t.id !== id));
        } catch (err) {
          console.error("Failed to delete tag", err);
          alert("Failed to delete tag. Please try again.");
        }
      },
    });
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

  const handleDeleteAccount = (id) => {
    setConfirmDialog({
      title: "Delete account?",
      message: "Are you sure you want to delete this account? All associated transactions will be removed permanently.",
      confirmLabel: "Delete",
      danger: true,
      onConfirm: async () => {
        try {
          await api.delete(`/accounts/${id}`);
          setAccounts(accounts.filter(a => a.id !== id));
          if (selectedAccountId === id) setSelectedAccountId(null);
          onAccountCreated?.();
        } catch (err) {
          console.error("Failed to delete account", err);
          alert("Failed to delete account. Please try again.");
        }
      },
    });
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

  const handleRestore = () => {
    if (!restoreFile) return;
    setConfirmDialog({
      title: "Restore from backup?",
      message:
        `Restore from "${restoreFile.name}"?\n\n` +
        'This REPLACES every account, transaction, budget, bill and statement file in this app — ' +
        'for all users — with the contents of that backup. Anything added since it was taken is lost.\n\n' +
        'A copy of the current data is saved first, so this can be undone from the server if needed.',
      confirmLabel: "Restore",
      danger: true,
      onConfirm: async () => {
        setRestoring(true);
        setRestoreProgress(0);
        setBackupError(null);
        try {
          await restoreBackup(restoreFile, (e) => {
            if (e.total) setRestoreProgress(Math.round((e.loaded / e.total) * 100));
          });
          // Everything on screen — accounts, categories, the selected account — came from the
          // database that was just replaced, so reload rather than try to re-sync it piecemeal.
          window.location.reload();
        } catch (err) {
          console.error('Failed to restore backup', err);
          setBackupError(await readApiError(err, 'The restore failed. Your existing data was left in place.'));
          setRestoring(false);
        }
      },
    });
  };

  /* ---- Software updates ---- */
  const [updateStatus, setUpdateStatus] = useState(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [updateMessage, setUpdateMessage] = useState(null);
  const [updateError, setUpdateError] = useState(null);
  const updateRestart = useRef(null);
  // Use the desktop installer unless the server explicitly supports an elevated launch.
  const [manualInstallation, setManualInstallation] = useState(true);
  const updateState = updateStatus?.state;

  useEffect(() => {
    let disposed = false;
    getUpdateInstallation().then(res => {
      if (!disposed) setManualInstallation(res.data?.requiresManualInstallation !== false);
    }).catch(() => { /* Older servers also need the safe desktop installation flow. */ });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    let timer;
    let disposed = false;
    let fetching = false;
    let latestStatus = null;
    const fetchStatus = async () => {
      if (fetching || disposed) return;
      fetching = true;
      try {
        const res = await getUpdateStatus();
        if (disposed) return;
        latestStatus = res.data;
        setUpdateStatus(res.data);
        if (isInstallingUpdate(res.data) && !manualInstallation && !updateRestart.current) {
          updateRestart.current = { target: res.data?.updateInfo?.latestVersion, startedAt: Date.now() };
        }
        if (getUpdateOutcome(res.data, updateRestart.current) === "complete") {
          updateRestart.current = null;
          window.location.reload();
        }
      } catch {
        // The service can be unreachable while the installer restarts it.
      } finally {
        fetching = false;
        const outcome = getUpdateOutcome(latestStatus, updateRestart.current);
        if (!disposed && updateRestart.current && !updateRestart.current.reported && (outcome === "timeout" || outcome === "failed")) {
          updateRestart.current.reported = true;
          setApplyingUpdate(false);
          setUpdateMessage(null);
          setUpdateError(outcome === "failed"
            ? "The installer reported a failure. Download setup and run it as administrator on the server computer. Check the application logs if setup fails again."
            : "The upgrade has not completed after 3 minutes. Download setup and run it as administrator on the server computer. The running version has not yet been verified as updated.");
        }
      }
    };

    fetchStatus();

    const isBusy =
      updateState === "Downloading" ||
      updateState === 4 ||
      (!manualInstallation && (updateState === "Installing" || updateState === 6));

    const interval = isBusy ? 1000 : (activeTab === "updates" ? 5000 : 60000);
    timer = setInterval(fetchStatus, interval);
    return () => { disposed = true; clearInterval(timer); };
  }, [activeTab, manualInstallation, updateState]);

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateError(null);
    setUpdateMessage(null);
    try {
      const res = await checkForUpdates();
      setUpdateStatus(res.data);
      if (res.data?.updateInfo?.isUpdateAvailable) {
        setUpdateMessage(`New version v${res.data.updateInfo.latestVersion} is available!`);
      } else {
        setUpdateMessage(`You are running the latest version (v${res.data?.updateInfo?.currentVersion || "3.1.0"}).`);
      }
    } catch (err) {
      setUpdateError(err?.response?.data?.message || "Failed to check for updates. Check internet connectivity.");
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleDownloadUpdate = async () => {
    setUpdateError(null);
    setUpdateMessage(null);
    try {
      const res = await downloadUpdate();
      setUpdateStatus(res.data?.status || res.data);
    } catch (err) {
      setUpdateError(err?.response?.data?.message || "Failed to start download.");
    }
  };

  const handleCancelDownload = async () => {
    try {
      const res = await cancelDownload();
      setUpdateStatus(res.data);
    } catch (err) {
      console.error("Failed to cancel download", err);
    }
  };

  const handleApplyUpdate = () => {
    if (applyingUpdate || isInstallingUpdate(updateStatus)) return;
    setConfirmDialog({
      title: "Apply update and restart?",
      message:
        `Upgrade to v${updateStatus?.updateInfo?.latestVersion || ""}?\n\n` +
        "The application service will stop, update its program files, apply any database migrations, and restart automatically.\n\n" +
        "Your statements, database, and uploads in Data/ will be preserved. Do you wish to continue?",
      confirmLabel: "Install & Restart",
      danger: false,
      onConfirm: async () => {
        setApplyingUpdate(true);
        setUpdateError(null);
        setUpdateMessage(null);
        try {
          const res = await applyUpdate(true);
          setUpdateMessage(res.data?.message || "Update started. Application is restarting...");
          updateRestart.current = { target: updateStatus?.updateInfo?.latestVersion, startedAt: Date.now() };
        } catch (err) {
          setApplyingUpdate(false);
          if (err?.response?.data?.code === "manual_install_required") setManualInstallation(true);
          setUpdateError(err?.response?.data?.message || "Failed to launch installer.");
        }
      },
    });
  };

  const handleSaveFileDirectly = async () => {
    if (applyingUpdate) return;
    setApplyingUpdate(true);
    setUpdateError(null);
    setUpdateMessage(null);
    try {
      await downloadUpdateBinary();
      setUpdateMessage("Setup downloaded. On the computer hosting Bank Statement Analytics, open the downloaded file, choose Run as administrator, and approve the Windows prompt. After setup finishes, refresh this page to verify the version.");
    } catch {
      setUpdateError("Failed to download setup file to browser.");
    } finally {
      setApplyingUpdate(false);
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
    tags: tags.length ? String(tags.length) : null,
    rules: rulesCount !== null ? String(rulesCount) : null,
    reminders: remEnabled ? 'On' : 'Off',
    privacy: maskAmounts ? 'Hiding' : null,
    appearance: THEME_OPTIONS.find(t => t.id === preference)?.label,
    network: null,
    profile: null,
    backup: isAdmin ? null : 'Admin',
    updates: updateStatus?.updateInfo?.isUpdateAvailable ? 'New' : null,
    help: null,
  };

  const section = SECTIONS.find(s => s.id === activeTab) ?? SECTIONS[0];
  const activeIndex = SECTIONS.findIndex(s => s.id === section.id);
  const prevSection = activeIndex > 0 ? SECTIONS[activeIndex - 1] : null;
  const nextSection = activeIndex < SECTIONS.length - 1 ? SECTIONS[activeIndex + 1] : null;
  const currentGroup = SECTION_GROUPS.find(g => g.id === section.group);
  const cardAccounts = accounts.filter(a => a.bankName === 'HDFCCreditCard');

  /* ---- Panels ---- */

  const renderAppearance = () => <AppearanceSettings SettingCard={SettingCard} THEME_OPTIONS={THEME_OPTIONS} fontSize={fontSize} preference={preference} setFontSize={setFontSize} setPreference={setPreference} />;

  const renderReminders = () => <ReminderSettings REMINDER_PRESETS={REMINDER_PRESETS} SettingCard={SettingCard} handleTestNotification={handleTestNotification} notifPermission={notifPermission} remEnabled={remEnabled} remWindow={remWindow} toggleReminders={toggleReminders} updateWindow={updateWindow} />;

  const renderPrivacy = () => <PrivacySettings SettingCard={SettingCard} maskAmounts={maskAmounts} maskNamesEnabled={maskNamesEnabled} setMaskAmounts={setMaskAmounts} setMaskNamesEnabled={setMaskNamesEnabled} />;

  const renderHelp = () => <HelpSettings GITHUB_REPO={GITHUB_REPO} SettingCard={SettingCard} newIssueUrl={newIssueUrl} />;

  const renderBackup = () => <BackupSettings SettingCard={SettingCard} backupError={backupError} backupStatus={backupStatus} downloadingBackup={downloadingBackup} formatBytes={formatBytes} handleDownloadBackup={handleDownloadBackup} handleRestore={handleRestore} isAdmin={isAdmin} restoreFile={restoreFile} restoreInputRef={restoreInputRef} restoreProgress={restoreProgress} restoring={restoring} setBackupError={setBackupError} setRestoreFile={setRestoreFile} />;

  const renderUpdates = () => <UpdateSettings SettingCard={SettingCard} applyingUpdate={applyingUpdate} manualInstallation={manualInstallation} checkingUpdate={checkingUpdate} formatBytes={formatBytes} handleApplyUpdate={handleApplyUpdate} handleCancelDownload={handleCancelDownload} handleCheckUpdate={handleCheckUpdate} handleDownloadUpdate={handleDownloadUpdate} handleSaveFileDirectly={handleSaveFileDirectly} updateError={updateError} updateMessage={updateMessage} updateStatus={updateStatus} />;

  const renderAccounts = () => <AccountSettings accounts={accounts} autoDraft={autoDraft} autoDrafts={autoDrafts} autoOpen={autoOpen} browse={browse} cardAccounts={cardAccounts} cardDraft={cardDraft} cardDrafts={cardDrafts} editAccountName={editAccountName} editingAccountId={editingAccountId} gpayAutoOpen={gpayAutoOpen} gpayConfig={gpayConfig} gpayDraftPath={gpayDraftPath} gpayMessage={gpayMessage} gpaySweeping={gpaySweeping} gpayUserName={gpayUserName} handleDeleteAccount={handleDeleteAccount} handleImportNow={handleImportNow} handleOpenNamePicker={handleOpenNamePicker} handleSaveAutoImport={handleSaveAutoImport} handleSaveCardSettings={handleSaveCardSettings} handleSaveGPayAutoImport={handleSaveGPayAutoImport} handleSaveGPayUserName={handleSaveGPayUserName} handleSweepGPay={handleSweepGPay} handleToggleAutoImport={handleToggleAutoImport} handleToggleGPayAutoImport={handleToggleGPayAutoImport} handleUpdateAccount={handleUpdateAccount} canEdit={canEdit} canManageServer={canManageServer} loadBrowse={loadBrowse} onlyLinkCreatedByMe={onlyLinkCreatedByMe} openBrowse={openBrowse} openBrowseGPay={openBrowseGPay} openHistory={openHistory} setAutoDraft={setAutoDraft} setAutoOpen={setAutoOpen} setBrowse={setBrowse} setCardDraft={setCardDraft} setCardDrafts={setCardDrafts} setEditAccountName={setEditAccountName} setEditingAccountId={setEditingAccountId} setGpayAutoOpen={setGpayAutoOpen} setGpayConfig={setGpayConfig} setGpayDraftPath={setGpayDraftPath} setGpayMessage={setGpayMessage} setGpayUserName={setGpayUserName} setOnlyLinkCreatedByMe={setOnlyLinkCreatedByMe} setParticipantList={setParticipantList} setShowPw={setShowPw} setSplitDisplayFilter={setSplitDisplayFilter} showPw={showPw} splitDisplayFilter={splitDisplayFilter} sweeping={sweeping} />;

  const renderCategories = () => <CategorySettings activeSubCatInputId={activeSubCatInputId} categories={categories} editCatName={editCatName} editCatNameError={editCatNameError} editingCatId={editingCatId} handleAddCategory={handleAddCategory} handleAddSubCategory={handleAddSubCategory} handleDeleteCategory={handleDeleteCategory} handleDeleteSubCategory={handleDeleteSubCategory} handleUpdateCategory={handleUpdateCategory} canEdit={canEdit} newCatName={newCatName} newCatNameError={newCatNameError} newSubCatName={newSubCatName} newSubCatNameError={newSubCatNameError} setActiveSubCatInputId={setActiveSubCatInputId} setEditCatName={setEditCatName} setEditCatNameError={setEditCatNameError} setEditingCatId={setEditingCatId} setNewCatName={setNewCatName} setNewCatNameError={setNewCatNameError} setNewSubCatName={setNewSubCatName} setNewSubCatNameError={setNewSubCatNameError} />;

  const renderTags = () => <TagSettings editTagName={editTagName} editTagNameError={editTagNameError} editingTagId={editingTagId} handleAddTag={handleAddTag} handleDeleteTag={handleDeleteTag} handleUpdateTag={handleUpdateTag} canEdit={canEdit} newTagError={newTagError} newTagName={newTagName} setEditTagName={setEditTagName} setEditTagNameError={setEditTagNameError} setEditingTagId={setEditingTagId} setNewTagError={setNewTagError} setNewTagName={setNewTagName} tags={tags} />;

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
            {SECTION_GROUPS.map(group => {
              const groupSections = SECTIONS.filter(s => s.group === group.id);
              if (!groupSections.length) return null;
              return (
                <div key={group.id} className="settings-nav-group">
                  <div className="settings-nav-group-header">
                    <span className="settings-nav-group-title">{group.label}</span>
                  </div>
                  <div className="settings-nav-group-items">
                    {groupSections.map(s => (
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
                  </div>
                </div>
              );
            })}
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
                    {results.map((item, i) => {
                      const sec = SECTIONS.find(s => s.id === item.section);
                      const grp = SECTION_GROUPS.find(g => g.id === sec?.group);
                      return (
                        <button key={`${item.section}-${item.title}`} className="search-result" onClick={() => jumpTo(item)}>
                          <span className="search-result-icon">
                            {sec?.icon}
                          </span>
                          <span className="search-result-text">
                            <span className="search-result-title">{item.title}</span>
                            <span className="search-result-desc">{item.desc}</span>
                          </span>
                          <span className="search-result-section">
                            <span className="search-result-group-tag">{grp?.label}</span>
                            <span className="search-result-sep">&rsaquo;</span>
                            <span className="search-result-section-tag">{sec?.label}</span>
                          </span>
                          {i === 0 && <FiCornerDownLeft size={14} className="search-result-enter" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <header className="settings-panel-head">
                <div className="settings-panel-head-text">
                  {currentGroup && (
                    <div className="settings-panel-breadcrumb">
                      <span>Settings</span>
                      <span className="settings-breadcrumb-sep">/</span>
                      <span className="settings-breadcrumb-group">{currentGroup.label}</span>
                    </div>
                  )}
                  <h1 className="settings-panel-title">{section.title}</h1>
                  <p className="settings-panel-sub">{section.subtitle}</p>
                </div>
                {activeTab === 'accounts' && canEdit && (
                  <button className="btn primary small" onClick={() => openAddAccount?.()}>
                    <FiPlus size={15} /> Add account
                  </button>
                )}
                {activeTab === 'categories' && (
                  <button className="btn small" onClick={fetchCategories} title="Reload categories">
                    <FiRefreshCw size={14} /> Refresh
                  </button>
                )}
                {activeTab === 'tags' && (
                  <button className="btn small" onClick={fetchTags} title="Reload tags">
                    <FiRefreshCw size={14} /> Refresh
                  </button>
                )}
                {activeTab === 'updates' && (
                  <button
                    className="btn small"
                    onClick={handleCheckUpdate}
                    disabled={checkingUpdate}
                    title="Check for software updates"
                  >
                    <FiRefreshCw size={14} className={checkingUpdate ? 'spin' : ''} /> Check now
                  </button>
                )}
              </header>

              <div className="settings-panel-body">
                {activeTab === 'accounts' && renderAccounts()}
                {activeTab === 'categories' && renderCategories()}
                {activeTab === 'tags' && renderTags()}
                {activeTab === 'rules' && <RulesManager />}
                {activeTab === 'reminders' && renderReminders()}
                {activeTab === 'privacy' && renderPrivacy()}
                {activeTab === 'appearance' && renderAppearance()}
                {activeTab === 'network' && <NetworkSettings />}
                {activeTab === 'profile' && <div id="set-profile-account"><ProfileSettings /></div>}
                {activeTab === 'backup' && renderBackup()}
                {activeTab === 'updates' && renderUpdates()}
                {activeTab === 'help' && renderHelp()}

                {/* Footer navigation for easily moving between sections */}
                <footer className="settings-panel-footer">
                  {prevSection ? (
                    <button
                      type="button"
                      className="settings-panel-nav-btn prev"
                      onClick={() => { setActiveTab(prevSection.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                    >
                      <span className="settings-nav-btn-hint">Previous Section</span>
                      <span className="settings-nav-btn-label">&larr; {prevSection.label}</span>
                    </button>
                  ) : <div />}
                  {nextSection ? (
                    <button
                      type="button"
                      className="settings-panel-nav-btn next"
                      onClick={() => { setActiveTab(nextSection.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                    >
                      <span className="settings-nav-btn-hint">Next Section</span>
                      <span className="settings-nav-btn-label">{nextSection.label} &rarr;</span>
                    </button>
                  ) : <div />}
                </footer>
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
                    {h.status !== 'Success' && canManageServer && (
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

      {/* ── NAME PICKER MODAL ── */}
      <Modal
        open={namePickerOpen}
        onClose={() => setNamePickerOpen(false)}
        title="Pick Your Name in Google Pay & Splits"
        subtitle="Choose how your name appears in your bank accounts or Google Pay group expenses"
        width={520}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '8px 0' }}>
          <div style={{ position: 'relative' }}>
            <FiSearch size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search contacts or type name..."
              value={namePickerSearch}
              onChange={(e) => setNamePickerSearch(e.target.value)}
              className="field-input"
              style={{ width: '100%', paddingLeft: '32px' }}
              autoFocus
            />
          </div>

          {/* Quick candidates */}
          {gpayConfig?.candidateUserNames && gpayConfig.candidateUserNames.length > 0 && (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px' }}>
                DETECTED FROM ACCOUNTS &amp; SPLITS:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {gpayConfig.candidateUserNames
                  .filter(n => !namePickerSearch || n.toLowerCase().includes(namePickerSearch.toLowerCase()))
                  .map((name, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleSelectCandidateName(name)}
                      className="btn btn--outline"
                      style={{ padding: '4px 10px', fontSize: '12px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}
                    >
                      <FiUserCheck size={12} style={{ marginRight: '4px', color: 'var(--primary, #3b82f6)' }} />
                      {name}
                    </button>
                  ))}
              </div>
            </div>
          )}

          {/* Contacts / Participants list */}
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px' }}>
              ALL DETECTED PARTICIPANTS &amp; CONTACTS:
            </div>
            {loadingParticipants ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                Loading contacts...
              </div>
            ) : (
              <div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid var(--border-color, #e5e7eb)', borderRadius: '6px' }}>
                {participantList
                  .filter(p => !namePickerSearch || p.name.toLowerCase().includes(namePickerSearch.toLowerCase()) || (p.vpa && p.vpa.toLowerCase().includes(namePickerSearch.toLowerCase())))
                  .map((p, idx) => (
                    <div
                      key={idx}
                      onClick={() => handleSelectCandidateName(p.name)}
                      style={{
                        padding: '8px 12px',
                        borderBottom: '1px solid var(--border-subtle, #f3f4f6)',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        transition: 'background 0.15s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-2, #f9fafb)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)' }}>{p.name}</div>
                        {p.vpa && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{p.vpa}</div>}
                      </div>
                      <button
                        type="button"
                        className="btn btn--outline"
                        style={{ padding: '3px 8px', fontSize: '11px' }}
                      >
                        Use Name
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
            <button
              type="button"
              className="btn btn--outline"
              onClick={() => setNamePickerOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmDialog}
        title={confirmDialog?.title}
        message={confirmDialog?.message}
        confirmLabel={confirmDialog?.confirmLabel}
        danger={confirmDialog?.danger}
        busy={confirmBusy}
        onConfirm={runConfirm}
        onCancel={closeConfirm}
      />
    </div>
  );
}
