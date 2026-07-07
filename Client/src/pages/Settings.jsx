import { useState, useEffect } from "react";
import { FiSettings, FiCreditCard, FiTag, FiUser, FiPlus, FiEdit2, FiX, FiBell } from "react-icons/fi";
import api from "../api/client";
import { useAccount } from "../context/useAccount";
import { useAuth } from "../context/useAuth";
import ProfileSettings from "../components/ProfileSettings";
import { REMINDERS_ENABLED_KEY, REMINDER_WINDOW_KEY, sendTestNotification } from "../hooks/useBillReminders";
import "./Settings.css";

export default function Settings({ isOpen, onClose, onAddAccount, onAccountCreated, accounts = [], setAccounts }) {
  const { selectedAccountId, setSelectedAccountId } = useAccount();
  const { isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState('accounts');
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
    if (isOpen) {
      fetchCategories();
    }
  }, [isOpen]);

  // Lock background scroll while modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

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

  if (!isOpen) return null;

  const TABS = [
    { id: 'accounts', label: 'Accounts', icon: <FiCreditCard size={17} /> },
    { id: 'categories', label: 'Categories', icon: <FiTag size={17} /> },
    { id: 'reminders', label: 'Reminders', icon: <FiBell size={17} /> },
    { id: 'profile', label: 'Profile', icon: <FiUser size={17} /> },
  ];

  const HEADERS = {
    accounts: { title: 'Manage Accounts', subtitle: 'Add, rename, or remove your linked bank accounts.' },
    categories: { title: 'Categories', subtitle: 'Organize your spending into categories and sub-categories.' },
    reminders: { title: 'Bill Reminders', subtitle: 'Get a desktop notification when a recurring bill is due soon.' },
    profile: { title: 'Profile', subtitle: 'Manage your account and personal details.' },
  };

  return (
    <>
      <div className="settings-backdrop" onClick={onClose} />

      <div className="settings-modal" role="dialog" aria-modal="true" aria-label="Settings">
        {/* Sidebar */}
        <aside className="settings-sidebar">
          <div className="settings-brand">
            <FiSettings size={20} />
            Settings
          </div>
          <nav className="settings-nav">
            {TABS.map(tab => (
              <button
                key={tab.id}
                className={`settings-nav-item${activeTab === tab.id ? ' active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Main panel */}
        <div className="settings-main">
          <button
            className="modal-close settings-close"
            onClick={onClose}
            title="Close"
            aria-label="Close settings"
          >
            <FiX size={16} />
          </button>

          <header className="settings-header">
            <div className="settings-header-text">
              <h1 className="settings-title">{HEADERS[activeTab].title}</h1>
              <p className="settings-subtitle">{HEADERS[activeTab].subtitle}</p>
            </div>
            {activeTab === 'accounts' && isAdmin && (
              <button
                className="btn primary small"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                onClick={() => setTimeout(() => { if (onAddAccount) onAddAccount(); }, 150)}
              >
                <FiPlus size={15} /> Add Account
              </button>
            )}
          </header>

          <div className="settings-body">

            {/* ── Profile ── */}
            {activeTab === 'profile' && <ProfileSettings />}

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

                {/* Diagnostics — tells you exactly why a toast can't show */}
                <div className="settings-row">
                  <div style={{ minWidth: 0 }}>
                    <h3 className="settings-row-title">Diagnostics</h3>
                    {(() => {
                      const supported = typeof Notification !== 'undefined';
                      const secure = typeof window !== 'undefined' && window.isSecureContext;
                      const perm = supported ? Notification.permission : 'n/a';
                      const embedded = /electron|vscode/i.test(navigator.userAgent);
                      const rows = [
                        ['Notifications API', supported ? 'available' : 'NOT available', supported],
                        ['Secure context', secure ? 'yes' : 'NO (needs https or localhost)', secure],
                        ['Permission', perm, perm === 'granted'],
                        ['Reminders enabled', remEnabled ? 'yes' : 'no', remEnabled],
                        ['Origin', typeof window !== 'undefined' ? window.location.origin : '-', true],
                        ['Embedded browser', embedded ? 'YES — use a real browser' : 'no', !embedded],
                      ];
                      return (
                        <div style={{ marginTop: '8px', fontSize: '12px', fontFamily: 'monospace', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 16px' }}>
                          {rows.map(([k, v, ok]) => (
                            <div key={k} style={{ display: 'contents' }}>
                              <span style={{ color: 'var(--text-muted, #6b7280)' }}>{k}</span>
                              <span style={{ color: ok ? 'var(--success, #16a34a)' : 'var(--danger, #ef4444)', fontWeight: 600 }}>{String(v)}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                    <p className="settings-row-sub" style={{ marginTop: '10px' }}>
                      If any row above is red, that's the cause. Web notifications do not work in
                      VS Code's Simple Browser or embedded webviews — open the app in Chrome/Edge at{' '}
                      <code>http://localhost:5000</code>.
                    </p>
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
                          </div>
                        </div>

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
        </div>
      </div>
    </>
  );
}