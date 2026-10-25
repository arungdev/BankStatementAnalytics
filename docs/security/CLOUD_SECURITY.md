# Cloud upload and multi-user policy

Set `Deployment__PublicHosting=true` for a public server (already set in Compose).
New statement uploads are parsed in memory. Transactions, import status, hashes,
warnings and the original filename remain in the database; the original statement
bytes and statement password are not saved by the cloud import pipeline. Takeout
archives are processed in memory; imported financial evidence remains in the database.
Multipart buffering is kept in memory and upload processing is serialized to bound
resource use. Container swap, crash dumps and host memory protection remain operator
responsibilities; this is not a promise of forensic erasure from host memory.

Existing retained files are preserved. No automatic deletion of historical customer
files is performed. Review and remove those separately after a verified encrypted
backup if a migration requires deleting originals. Desktop development retains its
existing file-storage behavior when public hosting is false.

Cloud mode disables server folder browsing, watched folders, path-based imports,
browser backup/restore, network changes and desktop update operations. Operators use
SSH for backups and maintenance. Uploaded files are not served as public static files.

Each user has separate owned accounts and GPay settings. Account creation accepts
only editable account fields; ownership and IDs are assigned on the server. Session
tickets are encrypted, persisted in a separate Sessions volume, and revoked on logout.
Password, role and active-status changes invalidate existing sessions on the next
authenticated request. Idle expiry is 30 minutes, with an eight-hour absolute limit.
This file-backed session store supports one active application process per store.
Public cloud authentication in 4.0.2 is Google-only: verified Google signup creates
a separate regular-user workspace with profile name/email. No owner email or first
administrator is required. Every cloud Google identity is a regular user, including
the first signup. Existing Google administrator sessions must sign in again and
their account role becomes User while retaining the same financial data.
No linking or application password is required. Public password endpoints and old
password-authenticated sessions are rejected. Local installations retain password
login, and operators retain private SSH-tunnel recovery. Existing local account data
is preserved but is never automatically assigned to a new Google signup by email.

## Reusable Common.Framework components

Canonical source is in `Common.Framework/Deployment`, exported into `deploy/common`:

| Component | Reusable responsibility |
| --- | --- |
| `BoundedUpload` | Reject streams exceeding an explicit byte limit |
| `PersistentTicketStore` | Protected durable cookie tickets, logout revocation, expiry and restore revocation |
| `ApiRequestSecurity` | Same-origin checks for unsafe API requests and no-store response headers |
| `RootedFileStore`, `ProtectedValueStore` | Confined storage paths and protected values |
| Deployment scripts | SSH authentication, HTTPS, secret files, encrypted backups and restoration |

Financial ownership queries, bank parsers, GPay matching, and account provisioning
remain in this application. They depend on its data model and business rules.
Run `scripts/update-common-deployment.ps1` after editing canonical shared source and
`scripts/verify-common-deployment.ps1` to verify consumer hashes. Do not replace the
vendored framework DLL with a build of the older framework source.

## Google signup and sign-in on cloud

Google login requires Client ID and Client Secret only. Incomplete configuration
fails closed. Create a Google OAuth web
application and register this exact authorized redirect URI:

`https://YOUR-DOMAIN/signin-google`

Put the client ID in `.env` as `GOOGLE_CLIENT_ID`. No owner email setting is required.
Put only the client secret in
`secrets/google_client_secret.txt`, protected by the server secrets directory.
Run `Setup.bat` to configure these values interactively, or start manually using the optional override:

```bash
docker compose -f docker-compose.yml -f deploy/google-compose.yml --profile https up -d --wait
```

Use the same override for subsequent manual Compose operations. The new Setup
launcher preserves enabled Google settings. Users select Sign up with Google or
Sign in with Google. Google subject IDs define identity; email never merges existing
workspaces. New users receive seeded private categories/tags, not another account's
financial records. Real Google-console configuration and a browser callback still
require verification with the operator's credentials. Correlation cookies remain
mandatory; missing cookies cause a safe, logged error category.

## Database and backup upgrade prerequisites

Fresh installations create a separate PostgreSQL operator role and a non-superuser
application role. Existing volumes are not reinitialized. `Setup.bat` now prepares
encrypted backups and migrates the supported original deployment automatically.
It verifies the operator password using the container's network address before
removing cluster privileges. PostgreSQL's initial role (OID 10) cannot lose
SUPERUSER: it is renamed to a non-login bootstrap owner, while a replacement app
login keeps the existing password and receives the app database/schema/table
ownership in a transaction. Cluster default databases stay with the bootstrap owner.
Unknown operator passwords, other application databases or custom public functions
stop the automated migration for manual review. The cloud app refuses cluster-admin
credentials. Never delete a database volume to upgrade.

Backups now require `age` and `secrets/backup-recipients.txt`. Generate an age identity
on a trusted separate computer, store its private key off the server, and copy only
its public recipient to that file. Keep a tested private-key recovery copy. Restore
uses `BACKUP_IDENTITY_FILE=/secure/path/to/identity.txt bash deploy/restore.sh ...`.
Restoration clears existing sessions, requiring users to sign in again. Legacy
plaintext restoration requires an explicit `ALLOW_LEGACY_PLAINTEXT_RESTORE=true`.
Host disk encryption and independent off-server backup copies are still required
operator decisions.

## Verification and release state

Synthetic local checks passed: 46 import/ownership/cloud checks, 118 GPay matching
checks, 20 shared-bill checks, 11 shared session/upload checks, and 14 HTTP checks
against a disposable PostgreSQL/Linux Docker stack. Frontend production build and
Linux Docker image build passed. PostgreSQL reported the application role with
SUPERUSER, CREATEDB and CREATEROLE all false; application health became healthy.
Some Windows restores reported NU1900 because the package advisory feed was inaccessible;
this is not a clean vulnerability scan.

The local test image is `bankstatementanalytics:security-check`. The V4 release
coordinator publishes a versioned image and records its publication status and
registry digest in the release JSON beside the Setup artifacts. Publishing does
not update the live server; older published images and Setup ZIPs do not acquire
these changes. The updated dependency audit reported zero npm vulnerabilities and
no vulnerable .NET packages from the current feeds. Full endpoint authorization coverage,
real Google OAuth, encrypted backup recovery and host configuration verification remain
open audit work; these checks do not establish production readiness.
