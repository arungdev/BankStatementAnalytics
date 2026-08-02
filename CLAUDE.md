# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

BankStatementAnalytics is a personal finance app that parses bank statement exports (HDFC, HDFC Credit Card, IOB) into structured transactions, categorizes them by merchant/counterparty, and serves trends/insights. It's an ASP.NET Core (net10.0) backend that serves a React (Vite) SPA as static files, backed by PostgreSQL via NHibernate — by default an embedded, bundled instance (`Database:Embedded`), or an external server via `Database:PostgresConnectionString`. The SQLite path still exists in `NHibernateHelper` as the fallback when `Database:Provider` isn't `Postgres`.

- `BankStatementAnalytics/` — the ASP.NET Core Web API host (controllers, parsers, NHibernate mappings, models).
- `Client/` — the React 19 + Vite frontend (pages: Overview, Transactions, Trends, Insights, Merchants, Reports, Budgets, Bills, Investments, Transfers, Settings, Upload).
- `Common.Client` — a **private, separate repo** holding the app-agnostic React layer (design tokens, UI primitives, theming, API client, auth shell). Same arrangement as `Common.Framework`: the app never compiles its source, it depends on the prebuilt bundle committed at `Client/vendor/common-client/` via `"@common/client": "file:./vendor/common-client"`. A local `Common.Client/` working copy is gitignored (author only) and rebuilt with `npm run release` there, which rebuilds `dist/` and re-vendors it. **Do not edit `Client/vendor/common-client/` — it is generated output.** See "The Client/Common.Client boundary" below.
- `Common.Framework` — a **private, separate repo** providing `DbHelper`, `NHibernateManager`, `Auth`, `Web`, and `Logging`. It is **not** part of a clone: the backend compiles against the vendored prebuilt DLL at `BankStatementAnalytics/lib/Common.Framework.dll` (a `<Reference>`, not a `ProjectReference`). A local `Common.Framework/` working copy is gitignored — present on the author's machine only, used to rebuild that DLL and to supply the embedded-PostgreSQL bundle. Never assume its source is available; treat it as a shared library whose changes affect other consumers.
- `Publish/` — output of the self-contained single-file EXE build (`build.bat`); not source.

## Commands

Backend (from `BankStatementAnalytics/`):
```
dotnet restore
dotnet build
dotnet run
```
There is no backend test project in this repo currently.

Frontend (from `Client/`):
```
npm install
npm run dev       # Vite dev server (localhost:5173-5175, CORS-allowed by the API — see Program.cs)
npm run build     # production build into Client/dist
npm run lint      # eslint .
```
Client also has an optional local Node server (`Client/server/index.js`, `npm run start:server`) — check `server/package.json` before assuming it's part of the main flow.

Single-file production EXE (from repo root):
```
build.bat
```
This runs `dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true` from `BankStatementAnalytics/`, outputting to `Publish/`. The `.csproj` has an MSBuild target (`BuildReactClient`) that only runs `npm install && npm run build` in `Client/` **when Configuration == Release** — in Debug/dev, the API and Vite dev server run as two separate processes and you must start the client yourself.

Release artifacts (from repo root): `build-installer.bat` publishes once and emits **two** things into `Setup/` — the Inno Setup installer (via the shared `Common.Framework/Installer` engine) and a portable ZIP (`BankStatementAnalytics-Portable-<version>.zip`, built by `BankStatementAnalytics/Installer/build-portable.{bat,ps1}`, also runnable on its own to repackage an existing `Publish/`). The portable ZIP is the same publish output plus the `pgsql` bundle and a generated README, minus the service scripts — no service, no writes outside the extracted folder, because `AppPaths.ResolveWritableAppDataDirectory()` already puts `Data\`/`Uploads\`/`Logs\` next to the exe and `EmbeddedPostgresManager` picks a free port per data directory. Its one collision point with an installed copy is the HTTP port (`Urls` in `appsettings.json`, 5080 for both).

Docker (from repo root): `docker compose up --build` builds the image and runs it against a `postgres:16-alpine` service on port 8080. The image sets `Database__Embedded=false` because the bundled embedded PostgreSQL ships Windows binaries; the compose file supplies the connection string. The Dockerfile deliberately does not copy `Common.Framework/` — see above. `Common.Client/` is likewise excluded (`.dockerignore`); the image needs only `Client/vendor/common-client/`, which `COPY Client/ Client/` already brings in.

Cloning fresh: nothing extra is needed — `dotnet build` works from a plain clone against the vendored DLL, and `npm install` in `Client/` resolves `@common/client` from the committed `Client/vendor/common-client/`. Only two things require the private repo (author only): `build-installer.bat`, and the ~150 MB embedded-PostgreSQL bundle that the csproj's `CopyPgsqlBundle` target copies when present (silently skipped when absent, in which case point the app at your own PostgreSQL).

## Architecture

### Request flow
`Program.cs` wires everything: MVC controllers, CORS for the Vite dev origins, a global exception-logging middleware, and NHibernate init (`NHibernateHelper.SessionFactory` forces schema creation at startup). API controllers are attribute-routed under `api/*` (`app.MapControllers()`); any non-API route falls back to `index.html` (`app.MapFallbackToFile`) so the React router handles client-side navigation in production.

### Data layer
- NHibernate (not EF), mapping-by-code (see `BankStatementAnalytics/Mappping/*Map.cs` — note the misspelled folder name, that's intentional/existing). The provider is chosen at runtime in `NHibernateHelper` from `Database:Provider` (Postgres by default, SQLite otherwise); config is layered `appsettings.json` → `appsettings.{Environment}.json` → environment variables, so `Database__PostgresConnectionString` can supply the password without committing it.
- `Common.Framework.Data.NHibernateManager.Initialize(dbPath, addMappings, seedData)` is generic/reusable; `NHibernateHelper` (app-specific) supplies this app's mappings and seed logic (default categories/subcategories, default tags) on first run, then creates expression indexes that mapping-by-code can't express. Writable state (SQLite DB file, embedded Postgres data dir, Data Protection keys) lives under `AppPaths.ResolveWritableAppDataDirectory()/Data` — resolved from the actual process executable path (not `AppContext.BaseDirectory`) to survive single-file self-extraction, and kept separate from the possibly read-only install dir.
- `Common.Framework.Data.DbHelper` is the generic CRUD/session facade (`GetSession`, `GetById<T>`, `SaveAsync`, `SaveOrUpdateManyAsync`, `FetchByQueryOver`, `FetchByCriteria`) used throughout controllers/services instead of injecting `ISession` directly.
- `ITransactionRepository` + `TransactionRepositoryFactory` (switches on `Bank` enum) exists alongside `DbHelper`-based querying in controllers — when adding bank-specific query logic, check whether it belongs in the repository or should just be a NHibernate LINQ query in the controller/service, matching the existing pattern nearby.

### Statement parsing (the core extensibility point)
Adding a new bank/format means:
1. Implement `IBankParser.Parse(string text, int accountId) : IEnumerable<BankTransaction>` (see `Services/Parser/*.cs`).
2. Register it in `BankParserRegistry.Parsers` (`Services/TextService.cs`) with its `Bank` enum value and file extension (`.txt` or `.csv`).
3. Add the DI registration is automatic — `Program.cs` loops over `BankParserRegistry.Parsers` and registers every `ParserType` as scoped.

`TextService.ExtractAsync` looks up the account's bank, picks the matching parser from the registry by `(Bank, FileExt)`, and falls back to content-sniffing (`FallbackDetect`) if no exact match — e.g. detecting HDFC by `"Narration"`/`"Debit Amount"`/`"Closing Balance"` headers, IOB by `"UPI/"`/`"TRF"`. Parsed transactions are deduped/upserted via `DbHelper.SaveOrUpdateManyAsync`, relying on `BankTransaction.Equals`/`GetHashCode` (keyed on `AccountId` + `BankReference` + `BankType`) for NHibernate's save-or-update identity check.

Uploads are stored under `Uploads/` on disk (GUID-named) with a corresponding `Upload`/`UploadTransaction` DB record; deleting an upload (`DELETE api/statements/upload/{id}`) removes the DB rows, the parsed `BankTransaction`s tied to that `UploadId`, and the file.

### Categorization
Transactions link to a `Merchant` (`CounterParty`) which carries a default `Category`/`SubCategory`. Per-transaction `CategoryOverride`/`SubCategoryOverride` win over the merchant's default when present (see the `Category`/`SubCategory` projection in `StatementApiController.GetTransactions`). `CounterPartyService` handles merchant matching/creation logic.

### Backup / restore
`api/backup/*` (Settings → Backup) produces and consumes one zip holding `manifest.json`, a `pg_dump --format=custom` of the whole database, and the `Uploads/` tree. **The implementation lives in Common.Framework** (`Common.Framework.Data.BackupService` + `Common.Framework.Web.BackupApiControllerBase`), so changing it means editing the private repo and re-vendoring `lib/Common.Framework.dll` — it can't be fixed from this repo. What's left here is the empty `BackupApiController : BackupApiControllerBase` (so MVC discovers the routes in this assembly) and the `BackupOptions` registered in `Program.cs`, which is where everything app-specific lives: the product name shown in messages and the download filename, `DescribeDatabase = NHibernateHelper.Describe`, `ResolveUploadsRoot = () => UploadStorage.Root`, and the default database name. Notes if you touch it:
- **Instance-wide, not tenant-scoped** — the dump covers every user's rows (including password hashes) and a restore replaces all of them, so the controller base is `[Authorize(Roles = Admin)]` and does *not* derive from `TenantControllerBase`.
- **PostgreSQL only.** `pg_dump`/`pg_restore` are located next to the app (`{appDir}\pgsql\bin`, the embedded bundle) and then on PATH; the SQLite fallback can't be restored while the app holds the file open, so both endpoints refuse with an explanation rather than shipping an unrestorable backup.
- Restore validates the zip, takes a pre-restore safety copy into `Data\Backups` (newest 5 kept), then runs `pg_restore --clean --if-exists --single-transaction` so a failure leaves the existing schema intact, and only swaps the `Uploads/` tree once the database is in.
- `NHibernateHelper.Describe()` is what exposes the resolved provider/connection string outside NHibernate (as `Common.Framework.Data.DatabaseInfo`) — it re-reads the layered config rather than caching what `SessionFactory` built, so it doesn't depend on init order.
- The framework assembly now uses `Npgsql` (connection-string parsing, `ClearAllPools`). Since it's referenced as a bare DLL, consumers must declare the `Npgsql` package themselves — same as `log4net`; this app already does.

### Frontend structure
- `App.jsx` defines routes and a shared `Layout` that lifts filter state (date range, account selection, group-by) per page (`Insights`, `Trends`, `Transactions`) so the sidebar/page header filter controls and the page body share state via `react-router`'s `Outlet` context rather than prop-drilling through routes.
- `src/api/client.js` is the app's single axios instance — it calls `createApiClient` from `@common/client` with this app's `baseURL: "/api"` and public routes (`/login`, `/setup`). Everything imports *this module*, not the factory. In dev the relative base relies on Vite's proxy; confirm proxy config in `vite.config.js` before changing API base paths.
- `src/context/AccountContext.jsx` holds the globally selected account (used across Transactions/Trends/Insights). `PrivacyContext` is likewise app-specific; `ThemeProvider`/`AuthProvider` come from `@common/client` and are wired in `main.jsx` (note `<AuthProvider api={api}>` — the axios instance is injected, not imported by the package).
- Charting uses both `chart.js`/`react-chartjs-2` and `recharts` — check which a given page already uses before adding a new chart library dependency. `src/theme/chartTheme.js` re-exports the shared `getToken` and extends the shared `useChartTheme` with this app's `income`/`spend` colors; chart code should import from there, not from `@common/client` directly.

### The Client/Common.Client boundary
What lives where, when adding or changing frontend code:

| In `@common/client` (generic) | In `Client/src` (app) |
|---|---|
| `ui/` primitives: Avatar, Badge, Button, Drawer, EmptyState, Modal, Select, Switch, Tabs | `components/`: PageHeader, AccountFilter, Sidebar, StatCard, CategoryPicker, CreditCardPanel, NotificationBell, OnboardingGuide, Daterangepicker |
| `ThemeProvider`/`useTheme`, `FONT_SIZE_OPTIONS`, `getToken`, `useChartTheme` | `AccountContext`, `PrivacyContext`, `utils/format.js` (INR + masking) |
| `usePersistedState`, `avatarColors`/`initials`, `ensurePermission`/`showDesktopNotification` | `usePersistedRange`, `useBillReminders` |
| `createApiClient`, `AuthProvider`/`useAuth`, `AuthShell` & friends | `api/*.js` endpoint wrappers, `pages/Login.jsx`, `pages/Setup.jsx` (copy + branding) |
| Styles: generic tokens, `.btn`/`.badge`/`.field-*`/loader/fades, `ui-*`, `auth-*` | `index.css` (app tokens: `--chart-income/spend`, `--stat-tile-*`, legacy aliases; layout, tables, cards), `components/filter-chip.css`, page CSS |

Rules of thumb:
- **The stylesheet order in `main.jsx` matters**: `@common/client/styles.css` first, then `index.css`, which overrides tokens and layers app rules on top.
- Anything whose name only makes sense for a finance app (income, spend, merchant, statement) stays in the app, even if the mechanism is generic.
- Changing a shared component means editing the `Common.Client` repo and re-vendoring — you cannot fix it from `Client/`. If the private repo isn't available, wrap or override in the app instead.

## Notes
- Logging goes through `Common.Framework.Logging.Log` (log4net-backed, configured via `log4net.config`), not `Console`/`ILogger` — controllers/services catch exceptions and call `Log.Exception(ex)` before returning `StatusCode(500, ...)`.
- JSON serialization is configured with `ReferenceHandler.IgnoreCycles` and `JsonStringEnumConverter` globally (`Program.cs`) — bear this in mind when serializing NHibernate entities with bidirectional navigation properties.
