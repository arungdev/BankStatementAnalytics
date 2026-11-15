import { useId, useState } from 'react';
import { FiEye, FiEyeOff } from 'react-icons/fi';
import { updateStatementPassword } from '../../api/accounts';
import { apiErrorMessage } from '../../utils/apiError';

export default function StatementPasswordSettings({ account, onSaved }) {
  const headingId = useId();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function save(clear = false) {
    setBusy(true);
    setMessage('');
    try {
      const { data } = await updateStatementPassword(account.id, clear ? '' : password);
      onSaved(account.id, data);
      setPassword('');
      setMessage(clear ? 'Saved password removed.' : 'Password saved for future statement uploads.');
    } catch (error) {
      setMessage(apiErrorMessage(error, 'Unable to save the statement password.'));
    } finally {
      setBusy(false);
    }
  }

  return <form className="account-panel" aria-labelledby={headingId} onSubmit={event => { event.preventDefault(); if (!busy && password) save(); }}>
    <h4 id={headingId} className="account-panel-title">Statement PDF password</h4>
    <p className="account-panel-hint">Save a password for uploads on this account. A password entered during upload overrides it.</p>
    <label className="settings-field">
      <span className="settings-field-label">New password</span>
      <span className="field-affix">
        <input type={showPassword ? 'text' : 'password'} autoComplete="new-password" maxLength={200} value={password}
          placeholder={account.hasStatementPassword ? 'Password saved' : 'No saved password'}
          disabled={busy} onChange={event => setPassword(event.target.value)} className="field-input" />
        <button type="button" className="field-affix-btn" aria-label={showPassword ? 'Hide password' : 'Show password'}
          onClick={() => setShowPassword(value => !value)}>
          {showPassword ? <FiEyeOff size={14} /> : <FiEye size={14} />}
        </button>
      </span>
    </label>
    <button type="submit" className="btn small primary" disabled={busy || !password}>Save password</button>
    <button type="button" className="btn small" disabled={busy || !account.hasStatementPassword} onClick={() => save(true)}>Clear saved password</button>
    {message && <p role="status">{message}</p>}
  </form>;
}
