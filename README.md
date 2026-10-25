# BankStatementAnalytics

A personal-finance app that parses bank statement exports (HDFC, HDFC Credit Card,
IOB — PDF, CSV, and text) into structured transactions, categorizes them by
merchant, and serves trends and insights. It's an ASP.NET Core (net10.0) Web API
that serves a React (Vite) SPA, backed by PostgreSQL (an embedded, bundled
instance by default, or your own server via `appsettings`).

## Features

- **Statement import** — upload HDFC / HDFC Credit Card / IOB statements as PDF
  (password-protected supported), CSV, or text; parsed transactions are deduped
  and upserted. A background watch-folder service auto-imports statements dropped
  into the folder configured per account.
- **Categorization** — transactions link to merchants (counterparties) that carry
  default categories; per-transaction overrides, inline tags, and notes.
- **Merchants** — merge/alias same-named counterparties, UPI-id matching, bulk and
  inline categorization from list rows, per-merchant spend and notes.
- **Analytics** — Overview dashboard, Trends, Insights, and Reports pages, each
  with drill-down from summary tiles into the transactions behind them, plus PDF
  report export.
- **Transfers** — detects money moved between your own accounts (a debit matched
  to an equal credit in another owned account within a few days) so the same
  rupees aren't counted as both spend and income; confirmed pairs are excluded
  from analytics.
- **Budgets** — monthly limits per category, with suggested limits derived from
  spending history.
- **Bills & reminders** — recurring-bill tracking, including unpaid credit-card
  bills.
- **Credit cards** — statement summaries, utilization, billing cycles, and due
  reminders.
- **Investments** — fixed-deposit tracking with maturity projections.
- **Multi-user** — first-run admin setup, login, and per-user data isolation.
- **Appearance & privacy** — light/dark/system themes and adjustable text size,
  plus a privacy toggle that masks amounts (and optionally merchant and bill
  names) for screen-sharing.

> **ℹ️ Published for reference / showcase.**
> This project's shared data-access, auth, logging, and embedded-PostgreSQL layers
> live in **`Common.Framework`**, a **private** repository. Rather than expose that
> source, the compiled library is **vendored as a prebuilt DLL** at
> [`BankStatementAnalytics/lib/Common.Framework.dll`](BankStatementAnalytics/lib/Common.Framework.dll)
> and referenced directly — so the backend **compiles from a plain clone**, no submodule
> access required. Two things still depend on the private repo and are therefore *not*
> included: the ~150 MB embedded-PostgreSQL binary bundle (the build skips copying it when
> absent — point the app at your own PostgreSQL via `appsettings` instead), and the
> framework source itself.
>
> The frontend has the same arrangement: the app-agnostic React layer — design
> tokens, UI primitives, theming, the API client and the auth shell — lives in
> **`Common.Client`**, also private, and is vendored as a prebuilt bundle at
> [`Client/vendor/common-client/`](Client/vendor/common-client/) and depended on as
> `@common/client`. `npm install` resolves it from that folder, so the SPA also
> **builds from a plain clone**.

## Quick start

Backend (from `BankStatementAnalytics/`):

```
dotnet restore
dotnet build      # builds against the vendored lib/Common.Framework.dll
dotnet run        # listens on http://localhost:5000 in Development
```

The database is created on first run — either the bundled embedded PostgreSQL
(`Database:Embedded`, the default) or your own server via
`Database:PostgresConnectionString`. See [Configuration](#configuration).

Frontend (from `Client/`, separate terminal — in Debug the API does not build or
serve the SPA):

```
npm ci
npm run dev       # Vite dev server on http://localhost:5007, proxying /api to :5000
```

Open [http://localhost:5007](http://localhost:5007) and complete the first-run
admin setup, then add an account and upload a statement.

`npm run lint` runs ESLint; `npm test` runs frontend regression checks.
`npm run build` outputs the production bundle
straight into the API's `wwwroot/`, which the published app serves (with a
fallback to `index.html` so client-side routing works).

## Configuration

Config is layered `appsettings.json` → `appsettings.{Environment}.json` →
environment variables, so any key can be overridden with a `__`-separated
variable (e.g. `Database__PostgresConnectionString`) — keep credentials there
rather than in the committed files.

| Key | Default | Purpose |
| --- | --- | --- |
| `Urls` | `:5000` dev, `:5080` published | Address the API listens on. |
| `Database:Provider` | `Postgres` | `Postgres`, or anything else for the SQLite fallback. |
| `Database:Embedded` | `true` | Use the bundled PostgreSQL (Windows only). Set `false` to use your own server. |
| `Database:PostgresConnectionString` | — | Used only when `Embedded` is `false`. |

Per-account settings — including the watch folder that statements are
auto-imported from — are configured in the app, not in `appsettings`.

On the frontend, the axios client uses a relative `baseURL` of `/api`, so no
config is needed for normal dev or production; copy `Client/.env.example` to
`Client/.env` only to point the SPA at a non-default API origin.

## Installing updates on Windows

For a Windows service installation, use **Settings → Updates → Download setup (.exe)**.
Run the downloaded setup as administrator on the computer hosting the application
and approve the Windows prompt. Setup stops the service before replacing program
files and restarts it afterwards; `Data/` and `Uploads/` are preserved. Refresh the
Updates page after setup finishes and verify the running version.

The service runs as LocalService and cannot display a desktop administrator prompt.
The update API therefore rejects service-session installer launches without changing
the update state. Desktop installation is also the fallback for older servers. An
elevated interactive host can use Install & Restart; the page reloads only after the
target version is reported and displays an error after three minutes or an installer
failure. Service-script errors abort setup instead of being silently ignored.

The installer lifecycle is maintained in `BankStatementAnalytics/Installer/Framework.iss`
so its fixes are included in this repository. Verify update regressions with
`dotnet run --project Tests/UpdateInstallation -p:ValidationBuild=true` and `npm test`
in `Client/`. Compile the product `.iss` with Inno Setup when validating installer edits.

## Builds & deployment

Release version: **v4.0.0**. See [release artifacts and upgrade prerequisites](docs/releases/RELEASE_NOTES_v4.0.0.md)
for changes, upgrade requirements, and remaining publication checks.

- **Single-file EXE** — `build.bat` (repo root) publishes a self-contained
  win-x64 executable to `Publish\`, bundling the built SPA (and the embedded
  PostgreSQL runtime when available).
- **V4 release bundle** — `build-installer.bat` opens a menu for local/publish mode,
  version selection, image TAR export and optional offline cloud ZIP. Local builds
  are saved in `Setup/Candidates/<version>` and do not upload. Explicit publish mode
  publishes and verifies the Docker image. See [build options and project layout](docs/PROJECT-STRUCTURE.md).
  Command-line options such as `-SkipPush` and `-Publish` remain available.
  The EXE installs the application as a Windows service.
  Building the local packages requires the private
  `Common.Framework` repo (author only).
- **Linux / Docker** — follow [the Ubuntu deployment guide](deploy/README.md)
  or launch `deploy-ssh.bat` on Windows to deploy the published image over SSH.
  The guide explains how
  to create the database secret, build and start the .NET 10/PostgreSQL services,
  and optionally enable Caddy HTTPS. The app listens at host loopback
  [http://localhost:8080](http://localhost:8080). Database, uploads, keys and logs
  use persistent volumes. The guide includes backup/restore scripts, resource
  limits, firewall configuration, verification, and safe update/rollback procedures.

> Updating the vendored artifacts (author only):
> - **Backend** — rebuild `Common.Framework` and copy its
>   `bin/Release/net8.0/Common.Framework.dll` into `BankStatementAnalytics/lib/`.
> - **Frontend** — run `npm run release` in `Common.Client`; it rebuilds the bundle
>   and refreshes `Client/vendor/common-client/`. Commit that folder.

Notes

- Uploads are saved to the `Uploads/` folder by default (git-excluded).
- Real bank statements used for parser tuning live in `samples/` (git-excluded — they contain account numbers).
- Keep secrets in environment variables or user-secrets; do not commit credentials.

## Import safety and regression checks

Statements have a 25 MB limit. Imports reserve an account-scoped file hash,
then commit transactions, merchants, card summaries, counts, and completion status
in one database transaction. Overlapping statements preserve existing notes,
tags, categories, and the upload that first introduced each transaction. Manual
and watch-folder imports for an account are serialized. Interrupted pending
imports and unfinished revert file cleanup are recovered before the next server
startup accepts requests.

Balance discrepancies and unrecognized merchants appear as review warnings in
the upload result/history; they do not automatically reject partial statements.
Use the review link to open the transactions added by the upload.

Saved PDF passwords are protected with ASP.NET Data Protection. Existing plaintext
values are converted at startup. Their dedicated key ring lives in
`Uploads/.statement-keys`, so the normal whole-instance backup includes it. Keep
the database and Uploads tree together when migrating manually; a database-only
copy cannot decrypt protected passwords without those keys. Backups contain
sensitive financial records and keys and should be stored privately. Auth-cookie
keys remain separate under `Data/Keys`.

Use one active application server per database; startup recovery and whole-instance
restore are designed for that deployment model. SQLite backup/restore remains
unsupported by the shared framework; use PostgreSQL for the built-in backup flow.

CI checks frontend lint, regression tests, production builds, vendored artifact
checksums, and backend regressions on SQLite and PostgreSQL. See
[Tests/README.md](Tests/README.md) for isolated local verification and
[VENDORED_DEPENDENCIES.md](docs/dependencies/VENDORED_DEPENDENCIES.md) for dependency provenance.

## License

This project is **source-available**, licensed under the
[PolyForm Noncommercial License 1.0.0](LICENSE.md).

You are free to use, modify, and share the code **for any
noncommercial purpose** (personal projects, study, hobby use,
non-profits, education, research). **Commercial use is not
permitted** without a separate license — open an issue to ask.

Note: this is *not* an OSI-approved "open source" license, because
it restricts use to noncommercial purposes. The third-party
dependencies (React, ASP.NET Core, NHibernate, etc.) and the
vendored `Common.Framework` library keep their own separate licenses.

## Repository organization

See [the documentation index and folder guide](docs/README.md) for documentation, source, tooling, and local artifact locations.
