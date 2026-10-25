# Verification — 25 October 2026

Inspected the actual BankStatementAnalytics project: .NET 10, React/Vite,
NHibernate/PostgreSQL, vendored Common.Framework DLL, Windows embedded PostgreSQL,
PDF generation, import/storage services, auth/network middleware, updates and backups.
Business calculations, parsers and database mappings were preserved.

## Passed locally

- `dotnet build BankStatementAnalytics/BankStatementAnalytics.csproj -p:ValidationBuild=true --no-restore`
- Release publish with `SkipClientBuild=true`, including the built SPA in published wwwroot.
- `npm test` (Client): 11 checks; `npm run build`: successful.
- UpdateInstallation regression executable: successful.
- ImportReliability: all 36 checks, using disposable SQLite on Windows.
- GPayMatching: 118 matching, profile isolation and pagination checks.
- SharedBills: 20 checks.
- LinuxDeployment: PDF rendering test on Windows.
- Compose configuration validation, including the HTTPS profile; `git diff --check`.
- `docker build -t bankstatementanalytics:linux-check .`: final Ubuntu/.NET 10 image
  built successfully. The first build identified vulnerable transitive Pkcs 8.0.1;
  explicitly selecting 8.0.2 removed those audit warnings in the final build.
  References: [Microsoft advisory](https://github.com/dotnet/announcements/issues/468),
  [package advisory](https://github.com/advisories/GHSA-846f-f764-76mx).

## Passed with Linux containers

Used a separate Compose project `bsa-linux-smoke`, randomly generated disposable
database credentials, isolated named volumes, and synthetic records only.

- PostgreSQL 16 initialized; application startup/migrations completed; DB-aware health probe passed.
- SPA returned successfully and unauthenticated accounts API returned 401.
- First-admin setup/login and authenticated account creation worked.
- Reports API produced an actual PDF inside Linux using DejaVu fonts.
- Application ran as a non-root user; wrote to the uploads volume.
- Forced application container recreation retained uploaded data.
- `deploy/backup.sh` captured DB + Data + Uploads while the app was stopped.
- After changing a test DB value and upload marker, `deploy/restore.sh` restored both.
- A cookie issued before recreation and restore still authenticated afterwards,
  confirming auth key persistence with the DB snapshot.
- Caddy started with a local certificate. HTTPS login returned 200 with a Secure
  auth cookie; authenticated GET returned 200; same-origin account POST returned 201.
  The local test used host loopback ports 8081/8443 instead of public 80/443.
- A proxy IP collision discovered in testing was fixed by reserving .254 for Caddy.

The shell smoke test and Ubuntu CI job retain these checks for future changes,
including HTTPS cookie/origin verification. CI itself was added but was not run
through GitHub during this session.

## Limits and remaining server checks

- No remote Ubuntu server was accessed or deployed to.
- Public DNS, ACME certificate issuance/renewal, firewall behavior and server reboot
  recovery require verification on the target VPS. Local HTTPS used Caddy's local
  certificate authority with certificate verification bypassed for that test only.
- No live financial data was migrated. Test migration and backup restore on a copy
  before moving the real installation; retain Windows data and encryption keys.
- Existing Windows regressions ran before the final Pkcs patch override; the final
  patched image compiled and passed Linux API/persistence/restore/HTTPS checks.
- Some initial Windows restores reported unavailable NuGet vulnerability data.
  The final Docker restore had network access and completed without audit warnings.
- Linux statement imports are additionally covered by the repository's existing
  PostgreSQL CI suite; that GitHub job was not executed during this session.
- Resource limits are initial VPS settings, not load-test results. Reboot/crash
  recovery is configured by restart policies but was not simulated on a VPS.
