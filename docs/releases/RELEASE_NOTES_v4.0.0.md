# Bank Statement Analytics 4.0.0

## Distribution

Run `build-installer.bat` from Windows to run the regression checks, publish a fresh
self-contained Windows application, build its EXE installer and portable ZIP,
build/publish `arungs125/bankstatementanalytics:4.0.0`, verify anonymous Docker Hub
access, and generate one cloud deployment ZIP. Run `docker login` once beforehand.
Requires .NET 10 SDK, Node/npm, Docker Desktop in Linux-container mode, Inno Setup,
and the local private PostgreSQL bundle for Windows packages.

Expected files in `Setup`:

- `BankStatementAnalytics-Setup-4.0.0.exe`: Windows service installation.
- `BankStatementAnalytics-Portable-4.0.0.zip`: Windows application without installation.
- `BankStatementAnalytics-Cloud-4.0.0.zip`: Ubuntu SSH deployment, HTTPS and Google
  setup helpers, with instructions. Downloads the published image; no source code,
  private credentials, original customer files or large Docker TAR is included.
- `BankStatementAnalytics-4.0.0-SHA256SUMS.txt` and `BankStatementAnalytics-4.0.0-release.json`:
  checksums, publication status and registry digest.

The coordinator is reusable Common.Framework deployment source, exported to
`deploy/common/build-release.ps1`. Product paths and repository are in
`scripts/release.config.psd1`. The project file's Version is authoritative; the build
automatically synchronizes `deploy/project.env`. Existing Docker release tags cannot be overwritten.
All output is built in a fresh `.build/releases` folder. Existing `Publish` data
and previous Setup versions remain untouched. Failed builds retain diagnostic
staging output but do not copy a complete release into Setup.

`build-installer.bat -SkipPush` creates local candidates in
`Setup/Candidates/4.0.0`; it does not publish an image. The cloud ZIP from such a
candidate cannot deploy an unpublished image. Old ZIPs and offline TARs are not
silently relabelled as V4.

## Application changes

- Public cloud statement imports process bytes in memory and retain financial
  records/history without saving original files. Desktop original-file retention
  and username/password login remain available.
- Per-user GPay configuration, account ownership checks, session revocation and
  bounded upload processing.
- Optional Google login with explicit linking to existing accounts; credentials
  remain outside images and packages. Local users can keep normal password login.
- Non-superuser PostgreSQL application role for fresh cloud installations and
  encrypted operator backup support.

## Existing server upgrade prerequisites

This is not an automatic database-role migration. Back up and test recovery before
upgrading. Existing databases need a separate tested operator login and the app
role's cluster privileges removed. Configure age backup recipients before the
launcher attempts an update backup. Never delete the database volume to upgrade.
See `CLOUD_SECURITY.md` for exact prerequisites, Google configuration and outstanding
security verification. Existing retained original files are not automatically deleted.

The updated cloud ZIP includes the all-in-one `Setup.bat`, which configures
off-server recovery keys, takes encrypted upgrade backups, migrates the original
PostgreSQL bootstrap login safely and retains existing environment/Google settings.
Every interactive setup input shows a sample. It also includes `deploy-ssh.bat`, `enable-https.bat` and
`setup-google-login.bat`. Google setup requires a Google OAuth web client whose
authorized redirect URI is your HTTPS application domain followed by `/signin-google`.

Build success, artifact checks and publication do not certify completion of the
security audit. Google provider callbacks, host security, full endpoint coverage
and encrypted backup recovery still need the checks recorded in `SECURITY_AUDIT.md`.
