import { useState, useEffect } from 'react';
import api from '../api/client';
import { useAuth } from '../context/useAuth';

export default function ProfileSettings() {
  const { username, role, isAdmin } = useAuth();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <ChangePasswordCard username={username} role={role} />
      {isAdmin && <UserManagementCard />}
    </div>
  );
}

function ChangePasswordCard({ username, role }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);

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
      setMessage({ type: 'success', text: 'Password updated.' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data || 'Could not change password.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Account</h3>
      <p style={{ color: 'var(--text-muted)', marginTop: '-8px' }}>
        Signed in as <strong>{username}</strong> ({role})
      </p>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '360px' }}>
        <input
          className="field-input"
          type="password"
          placeholder="Current password"
          value={currentPassword}
          onChange={e => setCurrentPassword(e.target.value)}
          required
        />
        <input
          className="field-input"
          type="password"
          placeholder="New password"
          value={newPassword}
          onChange={e => setNewPassword(e.target.value)}
          required
        />
        <input
          className="field-input"
          type="password"
          placeholder="Confirm new password"
          value={confirmPassword}
          onChange={e => setConfirmPassword(e.target.value)}
          required
        />
        {message && (
          <p style={{ color: message.type === 'error' ? 'var(--danger)' : 'var(--success)', margin: 0 }}>
            {message.text}
          </p>
        )}
        <button type="submit" className="btn primary" disabled={saving} style={{ alignSelf: 'flex-start' }}>
          {saving ? 'Saving...' : 'Change password'}
        </button>
      </form>
    </div>
  );
}

function UserManagementCard() {
  const [users, setUsers] = useState([]);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState(null);

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
      setNewUsername('');
      setNewPassword('');
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
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Users</h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
        {users.map(u => (
          <div key={u.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>{u.username}</strong>
              <span style={{ marginLeft: '8px', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                {u.role}{!u.isActive && ' · disabled'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {u.role !== 'Admin' && (
                <>
                  {u.isActive
                    ? <button className="btn small" onClick={() => disableUser(u.id)}>Disable</button>
                    : <button className="btn small" onClick={() => enableUser(u.id)}>Enable</button>}
                  <button className="btn danger small" onClick={() => deleteUser(u.id, u.username)}>Delete</button>
                </>
              )}
            </div>
          </div>
        ))}
        {users.length === 0 && (
          <p style={{ color: 'var(--text-muted)' }}>No other users yet.</p>
        )}
      </div>

      <h4>Add a user</h4>
      <form onSubmit={createUser} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          className="field-input"
          placeholder="Username"
          value={newUsername}
          onChange={e => setNewUsername(e.target.value)}
          required
        />
        <input
          className="field-input"
          type="password"
          placeholder="Password"
          value={newPassword}
          onChange={e => setNewPassword(e.target.value)}
          required
        />
        <button type="submit" className="btn primary">Add user</button>
      </form>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  );
}
