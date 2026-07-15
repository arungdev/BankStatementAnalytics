import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { AuthShell, AuthField, AuthPasswordField, AuthError, AuthSubmit } from '../components/AuthShell';

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
    <AuthShell
      title="Welcome"
      subtitle="Create the first admin account to get started"
      onSubmit={submit}
    >
      <AuthField
        label="Username"
        value={username}
        onChange={e => setUsername(e.target.value)}
        placeholder="Choose a username"
        autoComplete="username"
        autoFocus
        required
      />
      <AuthPasswordField
        label="Password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        placeholder="Choose a password"
        autoComplete="new-password"
        required
      />
      <AuthPasswordField
        label="Confirm password"
        value={confirmPassword}
        onChange={e => setConfirmPassword(e.target.value)}
        placeholder="Re-enter your password"
        autoComplete="new-password"
        required
      />

      <AuthError>{error}</AuthError>

      <AuthSubmit submitting={submitting} busyLabel="Creating...">
        Create admin account
      </AuthSubmit>

      <p className="auth-footer">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </AuthShell>
  );
}
