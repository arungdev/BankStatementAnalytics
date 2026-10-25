# Cloud setup: Google signup, no owner account

Extract the whole ZIP and run **Setup.bat**. It installs or updates the Ubuntu deployment, backs up an existing installation, prepares database permissions, enables HTTPS and configures Google.

All examples are generic documentation values. Enter your own real values when running setup:

| Input | Generic sample |
| --- | --- |
| SSH address | ubuntu@203.0.113.10 |
| Domain | billing.example.com (no https://) |
| Certificate email | admin@example.com |
| SSH/sudo password | Your Ubuntu password; input stays hidden |
| Reuse Google credentials | y or n (Enter keeps saved values) |
| Google Client ID | your-client-id.apps.googleusercontent.com |
| Google Client Secret | paste-your-client-secret (hidden) |

No owner Google email is requested. Create a Google OAuth Web application and register your actual callback URI. Generic sample:

https://billing.example.com/signin-google

While Google is in testing, add the intended accounts as test users.

The public cloud shows **Sign up with Google** and **Sign in with Google** only. No application username/password or Link Google step is needed. Every Google signup, including the first, receives a regular private workspace with its Google name and verified email. No Google user becomes administrator. Server management stays through SSH.

Existing Google administrator sessions must sign in again and will return as regular users in the same workspace. Existing data stays with the same user IDs. New Google signups do not merge old local accounts by email. Local Windows installations continue using normal password login. Private SSH-tunnel recovery remains available to operators; public HTTPS rejects password sessions.

Setup keeps the recovery private key on Windows under %LOCALAPPDATA%\CommonDeployment\BackupKeys and sends only its public recipient to Ubuntu. Keep an independent secure copy. On upgrades, encrypted snapshots are retained on the server and downloaded under %LOCALAPPDATA%\CommonDeployment\Backups. No recovery private keys or customer data are included in this ZIP.

Your domain must point to the server. Open provider inbound TCP 22 for SSH and 80/443 for HTTPS; keep PostgreSQL and 8080 private. Setup cannot create Google-console credentials or remove Chrome Safe Browsing warnings.

For a missing correlation cookie, clear this application's stale site cookies and start a new HTTPS Google flow in the same browser. Do not reopen an old callback URL or bypass a Dangerous-site warning. Safe diagnostic categories are logged as GoogleOAuth FailureCategory without tokens or provider response bodies.

To publish the next application release, run build-installer.bat in the development project. It chooses the next unused patch version automatically and synchronizes the EXE, portable ZIP, cloud ZIP and Docker tag. Running this cloud Setup.bat only installs its packaged version; it does not increment versions.
