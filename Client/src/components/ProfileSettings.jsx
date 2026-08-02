import { useState, useEffect } from 'react';
import { FiEye, FiEyeOff, FiUserPlus, FiSlash, FiTrash2, FiRotateCcw } from 'react-icons/fi';
import api from '../api/client';
import { Badge, useAuth } from "@common/client";

export default function ProfileSettings() {
  const { username, role, isAdmin } = useAuth();

  return (
    <div className="profile-groups">
      <section className="profile-group">
        <h2 className="profile-group-title">Account</h2>
        <IdentityCard username={username} role={role} />
        <ChangePasswordCard />
      </section>

      {isAdmin && (
        <section className="profile-group">
          <h2 className="profile-group-title">Users</h2>
          <UserManagementCard currentUsername={username} />
        </section>
      )}
    </div>
  );
}

function IdentityCard({ username, role }) {
  return (
    <div className="settings-row">
      <div className="settings-row-main">
        <div className="settings-avatar profile-avatar-lg">
          {(username || '?').charAt(0)}
        </div>
        <div style={{ minWidth: 0 }}>
          <h3 className="settings-row-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {username}
            <Badge variant={role === 'Admin' ? 'purple' : 'blue'}>{role}</Badge>
          </h3>
          <p className="settings-row-sub">You're signed in on this device.</p>
        </div>
      </div>
    </div>
  );
}

function ChangePasswordCard() {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);

  const close = () => {
    setOpen(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setReveal(false);
    setMessage(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    setMessage(null);

    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'New passwords do not match.' });
      return;
    }

    setSaving(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      // Collapse the form on success, but keep the confirmation visible.
      close();
      setMessage({ type: 'success', text: 'Password updated.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data || 'Could not change password.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-row">
      <div className="settings-row-head">
        <div style={{ minWidth: 0 }}>
          <h3 className="profile-section-title">Change password</h3>
          <p className="settings-row-sub">Use a strong password you don't reuse elsewhere.</p>
        </div>
        {!open && (
          <div className="settings-row-actions">
            <button type="button" className="btn small" onClick={() => { setMessage(null); setOpen(true); }}>
              Change password
            </button>
          </div>
        )}
      </div>

      {/* Success confirmation stays visible after the form collapses. */}
      {!open && message?.type === 'success' && (
        <p className="profile-msg success" style={{ marginTop: 'var(--space-3)' }}>{message.text}</p>
      )}

      {open && (
        <form onSubmit={submit} className="profile-form">
          <PasswordField
            label="Current password"
            value={currentPassword}
            reveal={reveal}
            onChange={setCurrentPassword}
          />
          <PasswordField
            label="New password"
            value={newPassword}
            reveal={reveal}
            onChange={setNewPassword}
          />
          <PasswordField
            label="Confirm new password"
            value={confirmPassword}
            reveal={reveal}
            onChange={setConfirmPassword}
          />

          <button
            type="button"
            className="profile-reveal-toggle"
            onClick={() => setReveal(v => !v)}
          >
            {reveal ? <FiEyeOff size={13} /> : <FiEye size={13} />}
            {reveal ? 'Hide passwords' : 'Show passwords'}
          </button>

          {message && (
            <p className={`profile-msg ${message.type}`}>{message.text}</p>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-2)', alignSelf: 'flex-start' }}>
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? 'Saving…' : 'Update password'}
            </button>
            <button type="button" className="btn" onClick={close} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function PasswordField({ label, value, reveal, onChange }) {
  return (
    <label className="profile-field">
      <span>{label}</span>
      <input
        className="field-input"
        type={reveal ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        required
      />
    </label>
  );
}

function UserManagementCard({ currentUsername }) {
  const [users, setUsers] = useState([]);
  const [adding, setAdding] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState(null);

  const closeAdd = () => {
    setAdding(false);
    setNewUsername('');
    setNewPassword('');
    setError(null);
  };

  const fetchUsers = () => {
    api.get('/auth/users')
      .then(res => setUsers(res.data || []))
      .catch(() => { });
  };

  useEffect(() => { fetchUsers(); }, []);

  const createUser = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/auth/users', { username: newUsername, password: newPassword, role: 'User' });
      closeAdd();
      fetchUsers();
    } catch (err) {
      setError(err.response?.data || 'Could not create user.');
    }
  };

  const run = async (action) => {
    setError(null);
    try {
      await action();
      fetchUsers();
    } catch (err) {
      setError(err.response?.data || 'Could not update the user.');
    }
  };

  const disableUser = (id) => {
    if (!window.confirm('Disable this user? They will no longer be able to log in.')) return;
    run(() => api.post(`/auth/users/${id}/disable`));
  };

  const enableUser = (id) => {
    run(() => api.post(`/auth/users/${id}/enable`));
  };

  const deleteUser = (id, username) => {
    if (!window.confirm(`Delete "${username}" and ALL their data (accounts, transactions, uploads, budgets)? This cannot be undone.`)) return;
    run(() => api.delete(`/auth/users/${id}`));
  };

  return (
    <>
      <div className="settings-list">
        {users.map(u => (
          <div key={u.id} className="settings-row">
            <div className="settings-row-head">
              <div className="settings-row-main">
                <div className={`settings-avatar${!u.isActive ? ' settings-avatar-muted' : ''}`}>
                  {(u.username || '?').charAt(0)}
                </div>
                <div style={{ minWidth: 0 }}>
                  <h3 className="settings-row-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {u.username}
                    {u.username === currentUsername && <Badge>You</Badge>}
                  </h3>
                  <p className="settings-row-sub profile-user-status">
                    <Badge variant={u.role === 'Admin' ? 'purple' : 'blue'}>{u.role}</Badge>
                    {!u.isActive && <Badge variant="amber">Disabled</Badge>}
                  </p>
                </div>
              </div>

              {u.role !== 'Admin' && (
                <div className="settings-row-actions">
                  {u.isActive ? (
                    <button className="btn small" onClick={() => disableUser(u.id)}>
                      <FiSlash size={13} /> Disable
                    </button>
                  ) : (
                    <button className="btn small" onClick={() => enableUser(u.id)}>
                      <FiRotateCcw size={13} /> Enable
                    </button>
                  )}
                  <button className="btn danger small" onClick={() => deleteUser(u.id, u.username)}>
                    <FiTrash2 size={13} /> Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {users.length === 0 && (
          <div className="settings-empty">
            <FiUserPlus size={32} />
            <div className="settings-empty-title">No other users yet</div>
            <div className="settings-empty-sub">Add a user below to give someone their own login.</div>
          </div>
        )}
      </div>

      {adding ? (
        <div className="settings-add-card" style={{ marginTop: 'var(--space-4)', marginBottom: 0 }}>
          <label className="settings-add-card-label">Add a user</label>
          <form onSubmit={createUser} className="settings-add-row" style={{ flexWrap: 'wrap' }}>
            <input
              className="field-input"
              placeholder="Username"
              value={newUsername}
              onChange={e => setNewUsername(e.target.value)}
              required
              autoFocus
              style={{ flex: '1 1 160px' }}
            />
            <input
              className="field-input"
              type="password"
              placeholder="Password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              required
              style={{ flex: '1 1 160px' }}
            />
            <button
              type="submit"
              className="btn primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
            >
              <FiUserPlus size={15} /> Add user
            </button>
            <button type="button" className="btn" onClick={closeAdd} style={{ whiteSpace: 'nowrap' }}>
              Cancel
            </button>
          </form>
          {error && <p className="profile-msg error" style={{ marginTop: 'var(--space-3)' }}>{error}</p>}
        </div>
      ) : (
        <button
          type="button"
          className="btn small"
          onClick={() => setAdding(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: 'var(--space-4)', alignSelf: 'flex-start' }}
        >
          <FiUserPlus size={15} /> Add a user
        </button>
      )}
    </>
  );
}
