import { useState } from 'react';

export function AuthShell({ title, subtitle, onSubmit, children }) {
  return (
    <div className="auth-page app-fade">
      <form onSubmit={onSubmit} className="auth-card">
        <div className="auth-logo">
          <img src="/icon-192.png" alt="Bank Analytics" />
        </div>
        <h1 className="auth-title">{title}</h1>
        <p className="auth-subtitle">{subtitle}</p>
        {children}
      </form>
    </div>
  );
}

export function AuthField({ label, ...inputProps }) {
  return (
    <div className="auth-field">
      <label>{label}</label>
      <input className="field-input" {...inputProps} />
    </div>
  );
}

export function AuthPasswordField({ label, ...inputProps }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="auth-field">
      <label>{label}</label>
      <div className="auth-password">
        <input className="field-input" type={visible ? 'text' : 'password'} {...inputProps} />
        <button
          type="button"
          className="auth-eye"
          onClick={() => setVisible(v => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          tabIndex={-1}
        >
          {visible ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
              <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

export function AuthError({ children }) {
  if (!children) return null;
  return (
    <div className="auth-error" role="alert">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span>{children}</span>
    </div>
  );
}

export function AuthSubmit({ submitting, busyLabel, children }) {
  return (
    <button type="submit" className="btn primary auth-submit" disabled={submitting}>
      {submitting && <span className="auth-spinner" />}
      {submitting ? busyLabel : children}
    </button>
  );
}
