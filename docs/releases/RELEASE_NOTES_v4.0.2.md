# Bank Statement Analytics 4.0.2

Cloud Google signup no longer asks for an owner email or requires an administrator
to sign up first. Every Google account, including the first signup, gets a regular
private workspace. No cloud Google user is assigned an administrator role.

Existing Google administrator sessions must sign in again. On their next Google
sign-in, those users become regular users while keeping the same user ID and
financial data. Other legacy local accounts remain preserved. Server maintenance
is performed through SSH. Local installations retain username/password login.

Setup.bat asks for server details and Google Client ID/Secret only. Reusing saved
credentials is supported. The obsolete GOOGLE_OWNER_EMAIL setting is removed from
the prepared environment, and the Google override no longer requires it.

All active setup samples and current instructions use reserved documentation
values such as ubuntu@203.0.113.10, billing.example.com and admin@example.com.
Actual publishing configuration continues targeting the configured Docker repository.

Run build-installer.bat to generate the EXE, portable ZIP, single cloud ZIP and
matching versioned Docker image. The existing encrypted backup, PostgreSQL upgrade,
HTTPS and diagnostic safeguards remain in effect. No real Google credentials,
recovery private keys or customer data are included in the cloud ZIP.

The release builder automatically chooses the next unused patch tag and synchronizes
all artifact versions, so manual patch-version edits are unnecessary. Setup/restarts
continue using the packaged version and never bump a release.

Regular users can create/edit their own accounts, categories/tags, transactions,
merchants and statement imports in the UI. Viewer restrictions and administrator-only
server controls remain separate. This corrects old UI checks that treated all
non-admin users as viewers.
