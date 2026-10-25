import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AuthError, AuthField, AuthPasswordField, AuthShell, AuthSubmit, useAuth } from "@common/client";
import { apiErrorMessage } from '../utils/apiError';
import useAuthenticationOptions from '../hooks/useAuthenticationOptions';
import { googleLoginError } from '../utils/googleLoginError';
import './Login.css';

function ArrowRight({ size = 17 }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>;
}

function LockKeyhole({ size = 14 }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" /></svg>;
}

function GoogleMark() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20">
    <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.89-1.74 2.98-4.3 2.98-7.36Z" />
    <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z" />
    <path fill="#FBBC05" d="M6.41 13.92a6 6 0 0 1 0-3.84V7.49H3.07a10 10 0 0 0 0 9.02l3.34-2.59Z" />
    <path fill="#EA4335" d="M12 5.96c1.47 0 2.79.51 3.82 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.49l3.34 2.59A6 6 0 0 1 12 5.96Z" />
  </svg>;
}

export default function Login() {
  const options = useAuthenticationOptions();
  const [searchParams] = useSearchParams();
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (options.googleOnly) return;
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

  if (options.loading) return <div className="boot-splash">Loading sign-in…</div>;
  if (options.unavailable) return <div className="boot-splash">Unable to load sign-in options. Please reload this page.</div>;
  return (
    <div className={`login-page${options.googleOnly ? ' login-page--google' : ''}`}><AuthShell
      title={options.googleOnly ? 'Your private workspace' : 'Welcome back'}
      subtitle={options.googleOnly ? 'A clearer picture of your money starts here.' : 'Sign in to Bank Statement Analytics'}
      logo={<img src="/icon-192.png" alt="Bank Analytics" />}
      onSubmit={submit}
    >
      {!options.googleOnly && <><AuthField
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

      </>}
      <AuthError>{error || googleLoginError(searchParams.get('googleError'))}</AuthError>

      {!options.googleOnly && <AuthSubmit submitting={submitting} busyLabel="Signing in...">
        Sign in
      </AuthSubmit>}
      {options.google && <div className="login-google-actions">
        <a className="login-google-button" href="/api/auth/google/start"><GoogleMark /><span>Sign in with Google</span><ArrowRight size={17} aria-hidden="true" /></a>
        {options.googleOnly && <div className="login-signup"><span>New to Bank Statement Analytics?</span><a href="/api/auth/google/start?signup=1">Create your workspace <ArrowRight size={14} aria-hidden="true" /></a></div>}
      </div>}
      {options.googleOnly && !options.google && <p>Google sign-in needs to be configured by the server operator.</p>}

      <p className="auth-footer">
        {options.googleOnly ? <><span className="login-privacy-label"><LockKeyhole size={14} aria-hidden="true" /> Your workspace. Your information.</span><span className="login-privacy-copy">Sign in securely with Google to access your private workspace.</span></> : (options.allowRegistration ? <>New here? <Link to="/setup">Create account</Link></> : 'Contact your administrator for an account or password reset.')}
      </p>
    </AuthShell></div>
  );
}
