import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthError, AuthField, AuthPasswordField, AuthShell, AuthSubmit, useAuth } from "@common/client";

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
      if (status === 423) {
        setError('Account is temporarily locked. Try again later.');
      } else {
        setError(err.response?.data || 'Invalid username or password.');
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
