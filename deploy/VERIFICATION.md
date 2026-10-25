# Verification — 25 October 2026

## Default HTTPS follow-up

The session now enables HTTPS automatically when the configured auth-status
endpoint reports needsSetup=false. It waits privately for first-admin setup on a
new instance; existing instances activate HTTPS immediately. Mocked shell tests
cover an existing administrator, setup changing from pending to complete, and
refusal to enable HTTPS after an unrecognized status response. Windows PowerShell
5.1 mocked-SSH tests cover enable-https.bat's HTTPS-only mode, which runs the
existing server Compose command without file transfers or redeployment. Both
deployment ZIPs include this helper. A live VPS run of the new default is still
required; the manually invoked equivalent command was reported working by the user.

## Publication and launcher follow-up

- Published `arungs125/bankstatementanalytics:3.1.0-linux-1da6c7b` successfully.
  Digest: `sha256:02eeb2fca27f0df558f247584525cdc665ad4ea6a4ae3b52c95eda52c5e44f88`.
  An anonymous Docker registry request returned HTTP 200 with that digest,
  confirming that this tag does not require an end-user Docker Hub login.
- Reused the original tested image for the exact source-commit tag; this release
  does not silently substitute a different build under the same tag.
- Windows PowerShell 5.1 tests passed for temporary Ed25519 generation, empty
  passphrase, cleanup, existing-key authentication and password bootstrap, using
  mocked SSH/SCP. Installation/admin tunnel/HTTPS use one interactive SSH session.
- The runtime-only ZIP has 19 files, including the new authentication/session
  helpers. Package tests verify that C# source and development tools are excluded.
- Optional offline ZIP includes a Docker-save archive under application-image.tar.
  Docker load restored the expected image tag locally; mocked launcher tests
  confirmed authenticated SCP upload. This path bypasses pulling the custom app
  image, while public DB/proxy images still require network access.
- Live SSH/sudo/temporary authorized_keys installation on the VPS has not been
  exercised by the agent; these checks still require an actual deployment run.

## Shared-module extraction verification

The reusable implementation now lives in Common.Framework/Deployment. Generated
deploy/common artifacts have SHA-256 checksums and are linked into the application;
the existing framework DLL remains unchanged. Project identity, PostgreSQL settings,
service names, ports and persistent paths are configured in deploy/project.env.

After extraction, the following checks passed:

- Application build with zero errors/warnings and final Linux Docker image build.
- All 36 import reliability checks: imports, legacy protected passwords, restored
  key ring, ownership and stored-path confinement.
- Update installation guard regressions with the thin product wrapper.
- Hosting/storage/PDF module tests on Windows and inside the Linux runtime,
  including quoted secret values, trusted/untrusted forwarded headers, local-only
  readiness, readiness failure, traversal rejection and Linux path case sensitivity.
- Cross-project deployment tests using synthetic invoice service/database/storage
  settings and mocked Docker: backup/restore selection, unsafe-root rejection,
  file-only projects, and refusal to restore another database's snapshot.
- Actual isolated Linux PostgreSQL/application smoke test: first-admin setup,
  authenticated APIs, PDF export, non-root execution, volume persistence, full
  backup/restore and preserved authentication cookies.
- Shared Caddy template with local HTTPS: Secure cookie, authenticated GET, and
  same-origin account creation through the trusted proxy.
- PowerShell/Bash syntax, Compose configuration and shared-module checksums.

The end-user ZIP was regenerated with the shared module. Remote SSH/Ubuntu Docker
installation remains untested without a target server. Test containers and volumes
were isolated from the normal application. Independent card/filter UI edits present
in the workspace were not changed by this extraction.

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
- The Windows SSH launcher has passed PowerShell parsing and the Ubuntu helper
  has passed Bash syntax validation. No remote server was used to test automatic
  Docker installation or the full SSH/SCP/sudo workflow.
# V4.0.0 release verification — 25 October 2026

The release coordinator generated all three V4 artifacts in `Setup` and published
`arungs125/bankstatementanalytics:4.0.0`. Anonymous registry verification returned
HTTP 200 with digest
`sha256:96cd2a3bb135e87336784998ba65d10c5648fa029e6559ccd76bdd3419460076`.

- 195 backend regression checks and 17 frontend tests passed.
- npm audit after compatible lockfile updates reported zero vulnerabilities;
  the .NET package advisory scan reported no vulnerable packages from its feeds.
- Windows application ProductVersion is 4.0.0. Its portable ZIP contains the
  PostgreSQL bundle and excludes runtime customer data and service helpers.
- Extracted portable app started against its own fresh embedded PostgreSQL on
  localhost:18091, passed readiness and exposed first-admin setup. Synthetic
  database and app processes were stopped afterwards.
- The published Linux image passed 14 multi-user HTTP checks on an isolated
  PostgreSQL stack. The application database role reported SUPERUSER, CREATEDB
  and CREATEROLE false. Test containers and volumes were removed afterwards.
- Cloud ZIP contains 30 runtime/document entries, uses image version 4.0.0,
  includes deployment/HTTPS/Google launchers and excludes source, Docker TARs,
  private credentials and customer data. All three SHA256 checksums matched.

The Inno installer was compiled but not installed over the existing local service.
No live Ubuntu deployment was performed. Existing-server database-role and backup
prerequisites still apply; consult `CLOUD_SECURITY.md`. The wider audit's remaining
checks are recorded in `SECURITY_AUDIT.md`.
