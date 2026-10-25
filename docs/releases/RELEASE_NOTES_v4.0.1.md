# Bank Statement Analytics 4.0.1

Public cloud login now provides **Sign up with Google** and **Sign in with Google**.
There is no public username/password form or Google account-linking step. A new
Google subject creates a new private user/workspace with its verified email and
display name. Returning subjects reuse their workspace. Existing local accounts
and financial data are preserved and are never merged based on email.

The server operator explicitly enters the owner Google email during Setup.bat.
Only that verified account receives administrator privileges. On a brand-new server,
the owner signs up first; a random visitor cannot become the first administrator.
Other Google signups become ordinary users. Local installations continue using
username/password login. Private SSH-tunnel recovery remains available to operators;
password-authenticated sessions are rejected on public HTTPS.

Setup.bat now asks for Google credentials/owner email before starting the cloud
containers and enables HTTPS without a password-bootstrap wait. Saved credentials
can be reused; every input shows a sample. Incomplete Google configuration fails
closed. Do not publish a cloud site before configuring Google.

Google OAuth errors are classified in `GoogleOAuth FailureCategory=...` server logs
and shown as fixed, actionable UI messages. Provider responses, access tokens and
secrets are never echoed in those diagnostic messages. Missing correlation cookies
are still rejected: clear the application's stale site cookies, start a fresh HTTPS
flow in the same browser, and do not reopen an old callback URL. Do not bypass Chrome's
Dangerous-site warning; address Search Console issues first.

Build with `build-installer.bat` for all three versioned artifacts and the matching
Docker Hub image. Existing PostgreSQL upgrade/backup safeguards remain in place.
Existing data is not automatically assigned to a new Google account; any intentional
data migration requires a separate reviewed operation.

Verification uses synthetic Google responses and isolated user databases. Real
Google-console configuration, browser cookie policies, Safe Browsing review and
the provider callback on the live server still require operator/browser verification.
