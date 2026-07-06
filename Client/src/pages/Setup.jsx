import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/useAuth';

export default function Setup() {
  const { setup } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await setup(username, password);
    } catch (err) {
      setError(err.response?.data || 'Could not complete setup.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--gray-50)',
    }}>
      <form onSubmit={submit} className="card" style={{ width: '380px', maxWidth: '90vw' }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 'var(--text-xl)' }}>Welcome</h1>
        <p style={{ margin: '0 0 20px', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
          Create the first admin account to get started.
        </p>

        <div style={{ marginBottom: '14px' }}>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: 'var(--text-sm)' }}>Username</label>
          <input
            className="field-input"
            style={{ width: '100%' }}
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoFocus
            required
          />
        </div>

        <div style={{ marginBottom: '14px' }}>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: 'var(--text-sm)' }}>Password</label>
          <input
            className="field-input"
            style={{ width: '100%' }}
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
        </div>

        <div style={{ marginBottom: '14px' }}>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: 'var(--text-sm)' }}>Confirm password</label>
          <input
            className="field-input"
            style={{ width: '100%' }}
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            required
          />
        </div>

        {error && (
          <p style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)', marginBottom: '14px' }}>{error}</p>
        )}

        <button type="submit" className="btn primary" style={{ width: '100%' }} disabled={submitting}>
          {submitting ? 'Creating...' : 'Create admin account'}
        </button>

        <p style={{ margin: '16px 0 0', textAlign: 'center', fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
          <Link to="/login" style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}>
            Back to sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
