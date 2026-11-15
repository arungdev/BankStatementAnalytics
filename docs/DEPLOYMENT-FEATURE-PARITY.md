# Local and cloud feature review

Here, **on device** means the installed application server running on the user's
computer. The browser still connects to that server. This is not an offline-first
browser app and does not synchronize a local database with a cloud database.

The finance APIs and React screens are shared across installations. Deployment
mode changes authentication, filesystem access, and original-file retention.

| Feature | Installed server | Public cloud |
| --- | --- | --- |
| Statement file upload and parsing | Supported | Supported |
| Saved account PDF password | Supported | Supported |
| Transactions, merchants, categories, tags, notes | Shared implementation | Shared implementation |
| Analytics, reports and PDF export | Shared implementation | Shared implementation |
| Transfers, budgets, bills, cards, investments, goals | Shared implementation | Shared implementation |
| GPay export upload, profiles and linked bank selection | Supported | Supported |
| Watch folders and server-folder browser | Server administrator | Use file upload |
| Original statement download | Retained local originals | Originals are not retained |
| User sign-in | Local authentication; optional Google | Google sign-in |
| Software installation, network access, whole-server backups | Server administrator | Hosting operator |

## Improvements in this review

- Added account-owned, encrypted password management independent of watch-folder
  permissions. Manual upload uses the saved password when no override is supplied.
- Added a GPay preferences endpoint for profile name and linked-bank changes,
  separate from privileged watch-folder configuration. It rejects folder and
  watcher fields and validates bank-account ownership.
- Updated linked-bank selection to use the preferences endpoint and hid the
  server-folder field during profile creation for cloud and ordinary users.
- Based server controls on public-hosting mode consistently.

## Verification and remaining deployment work

The regression suites use synthetic data. A shared implementation in the table
is an architectural finding, not a claim of end-to-end verification of every UI.
The local Linux-deployment checks exercise proxy trust, paths, readiness and PDF
generation; they do not start a real Linux host when run on Windows.

Before declaring complete parity, exercise the finance screens against both a
fresh local installation and a deployed HTTPS cloud instance with PostgreSQL.
Verify Google sign-in, tenant isolation, persistent encryption keys after restart,
uploads, report downloads and backup recovery on that instance.

True offline browser use, device-to-cloud synchronization and automatic import
from a user's device into the cloud need additional architecture. A cloud server
cannot watch a browser user's local folders; that requires a separately installed
device agent or a user-driven file upload.

## Reliability and maintenance improvements

- One statement-password editor serves both deployment modes. It updates the
  account's saved-password status immediately; folder settings no longer carry
  a second copy of the password editor or password draft.
- Statement and GPay folder pickers share one presentation component.
- Preference, onboarding, notification and transfer-dismissal storage accesses
  use the shared safe-storage adapter. Blocked or full browser storage cannot
  turn a completed server operation into a client-side exception.
- Notification and transfer identity sets use shared, shape-validated decoding.
- Account updates use functional state changes, preserving other account edits
  that finish while a request is pending. Initial GPay settings requests are
  cancelled on unmount, and failed identity saves display an actionable error.
- A cancelled import-now wait leaves other callers' sweep intact. Shutdown
  cancels queued waits, including during the watcher's startup delay, and stopped
  watchers refuse requests that cannot complete.
- Transaction edits and categorization rules share tag normalization. Empty and
  duplicate tags are removed; manual tag casing is independent of server culture.
- Categorization rules reject amount, mode and bank mismatches before checking
  narration. Narration is constructed lazily and reused across rules for each
  transaction, preserving the existing highest-priority-match behavior.

Regression coverage includes encrypted password save/clear and ownership,
caller cancellation and watcher shutdown, malformed and unavailable browser
storage, tag normalization, and rule priority/conditions/invalid regex behavior.
The broader suites cover GPay matching, shared bills, statement parsing,
deployment utilities, installer guards, session security and synthetic OAuth.

Verification on 15 November 2026 passed:

- Frontend lint, 34 frontend regressions, and the production build.
- Backend build; 105 import/reliability checks on SQLite and the same 105 checks
  against a new disposable PostgreSQL 16 database.
- 120 GPay matching/profile/pagination checks and 20 shared-bill checks.
- Deployment utilities, SBI statement parsing and update-installation suites.
- 22 session-security and synthetic Google-handler OAuth checks.
- 28 PostgreSQL schema-tenancy checks, security-object checks, financial-schema
  migration/snapshot checks, and real application HTTP isolation between two
  synthetic users. The disposable PostgreSQL container was removed afterward.

These checks do not certify every browser workflow or a public production host.
The NuGet vulnerability feed was unavailable during backend validation; these
results are functional checks, not a completed dependency vulnerability audit.
