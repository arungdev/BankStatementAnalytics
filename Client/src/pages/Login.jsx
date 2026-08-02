import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthError, AuthField, AuthPasswordField, AuthShell, AuthSubmit, useAuth } from "@common/client";
import { apiErrorMessage } from '../utils/apiError';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(username, password);
    } catch (err) {
      const status = err.response?.status;
      if (status === 429) {
        // The "auth" rate limiter rejects with an empty body - say why, rather than
        // letting it read as a wrong password and inviting more blocked attempts.
        setError('Too many sign-in attempts. Please wait a minute and try again.');
      } else if (status === 423) {
        setError(apiErrorMessage(err, 'Account is temporarily locked. Try again later.'));
      } else if (status === 401) {
        setError(apiErrorMessage(err, 'Invalid username or password.'));
      } else {
        setError(apiErrorMessage(err, 'Sign-in failed. Please try again.'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to BankStatementAnalytics"
      logo={<img src="/icon-192.png" alt="Bank Analytics" />}
      onSubmit={submit}
    >
      <AuthField
        label="Username"
        value={username}
        onChange={e => setUsername(e.target.value)}
        placeholder="Enter your username"
        autoComplete="username"
        autoFocus
        required
      />
      <AuthPasswordField
        label="Password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        placeholder="Enter your password"
        autoComplete="current-password"
        required
      />

      <AuthError>{error}</AuthError>

      <AuthSubmit submitting={submitting} busyLabel="Signing in...">
        Sign in
      </AuthSubmit>

      <p className="auth-footer">
        New here? <Link to="/setup">Create account</Link>
      </p>
    </AuthShell>
  );
}
