# Google-only cloud accounts

Run Setup.bat from the latest cloud ZIP. Enter Google Client ID and the hidden Client Secret when prompted, or reuse saved credentials. No owner email is needed. All prompt samples use generic values, never a user's personal credentials.

Create a Google OAuth Web application with your actual redirect URI. Generic example:
https://billing.example.com/signin-google

While Google is in testing, add the intended accounts as test users.

After setup, choose Sign up with Google or Sign in with Google on the HTTPS site. No application username/password or linking step is needed. Every signup is a regular private workspace, including the first. There is no cloud owner/admin Google account; server management is through SSH.

Existing local data is preserved. A new Google signup does not merge old accounts by email. Existing Google administrators sign in again as regular users and keep the same workspace data. Local installations retain password login.

Use setup-google-login.bat only for credential changes on the compatible updated application. A real Google browser callback still needs verification with the actual configured Google accounts. Do not bypass correlation validation or browser dangerous-site warnings.
