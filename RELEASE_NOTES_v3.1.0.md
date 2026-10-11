# Bank Statement Analytics v3.1.0

Release preparation: 11 October 2026. Publication and artifact checksums are pending.

## Changes since v3.0.0

- More reliable statement imports: account-scoped duplicate detection, atomic persistence, serialized manual/watch-folder imports, and recovery of interrupted imports and file cleanup. Overlapping statements preserve existing notes, tags, categories, and original upload ownership.
- Import review warnings for balance discrepancies and unrecognized merchants, with links to the imported transactions.
- Saved PDF passwords protected with ASP.NET Data Protection; legacy plaintext passwords are converted at startup.
- Improved account statement actions and Google Pay profile settings layout.
- Paginated Google Pay activity and insights, batched account summaries, deferred page/dialog loading, and request cancellation and response-order handling.
- Global search and anomaly links populate transaction search correctly, including account scope and navigation while the page is already open. Search queries honor cancellation; import-failure polling avoids overlapping requests.
- Expanded frontend and backend regressions, CI checks for SQLite and PostgreSQL, and vendored dependency checksum verification.

## Upgrade notes

Back up the instance before upgrading. Migration 8 adds recoverable import metadata, account/file-hash uniqueness, and room for protected statement passwords. Historical duplicate uploads are retained; only the earliest duplicate retains its file-hash reservation.

Keep the database and the entire `Uploads` tree together when moving or restoring an instance. `Uploads/.statement-keys` contains the keys required to decrypt saved PDF passwords; a database-only copy is insufficient. Preserve `Data`, `Uploads`, and configuration when upgrading a portable copy. Use one active application server per database.

## Release artifacts

Expected outputs from `build-installer.bat`:

- `Setup/BankStatementAnalytics-Setup-3.1.0.exe`
- `Setup/BankStatementAnalytics-Portable-3.1.0.zip`

Generate SHA-256 checksums from the final artifacts after packaging; do not reuse the v3.0.0 checksums.

## Release checklist

- [x] Complete frontend lint, regressions, production build, and vendor verification: 8 frontend tests, 10 report-range checks, and 4 vendor checksums passed. Build output is isolated under `.analysis-client-build/release-3.1.0`.
- [x] Complete GPay, shared-bill, and import/search regressions on SQLite: 118, 20, and 36 checks passed respectively, using `ValidationBuild=true` and existing restored dependencies (`--no-restore`).
- [ ] Complete import regressions on a fresh disposable PostgreSQL `bsa_regression` database or verify the PostgreSQL CI job.
- [ ] Build installer and portable ZIP from the validated source tree.
- [ ] Smoke-test clean installation and upgrade from v3.0.0, including saved PDF passwords and portable data preservation.
- [ ] Record final artifact sizes and SHA-256 checksums, then tag and publish v3.1.0.
