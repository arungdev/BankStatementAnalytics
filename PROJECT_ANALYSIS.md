# Project analysis

Reviewed on 3 October 2026 against the current working tree, including existing uncommitted GPay and bill-group changes. This is an architecture review and targeted code analysis, not an exhaustive security audit or verification of every runtime path. Application source was not changed.

## Architecture

BankStatementAnalytics is a personal finance application. It imports supported bank statements, resolves merchants, applies categorization rules, and presents transactions, spending analytics, budgets, recurring bills, investments, savings goals, credit-card reports, transfers, and shared expenses.

| Layer | Implementation | Main entry points |
|---|---|---|
| Web host | ASP.NET Core, .NET 10 | `BankStatementAnalytics/Program.cs` |
| API | Attribute-routed controllers under `/api`, generally inheriting `TenantControllerBase` | `BankStatementAnalytics/Controllers/Api/` |
| Business logic | Import, parsing, detection, reporting and financial calculations | `BankStatementAnalytics/Services/` |
| Persistence | NHibernate mapping by code; PostgreSQL by default, SQLite fallback | `NHibernateHelper.cs`, `Mappping/`, `Migrations/AppMigrations.cs` |
| Client | React 19, React Router, Vite, Axios; Chart.js and Recharts | `Client/src/App.jsx`, `Client/src/main.jsx` |
| Shared backend | Vendored private `Common.Framework.dll` | `BankStatementAnalytics/lib/` |
| Shared frontend | Vendored private `@common/client` package | `Client/vendor/common-client/` |

The shared libraries own substantial functionality: authentication, role gates, tenancy infrastructure, generic database helpers, backup/restore, updates, network access, UI primitives, themes and the API client. Their source is not part of the public project contract. Avoid editing generated frontend vendor files. Reviewing application call sites cannot establish all internal guarantees of these libraries.

## Startup and request flow

`Program.cs` resolves the executable and writable data directories, loads configuration, supports Windows service hosting, registers services and parsers, and starts database initialization and watch-folder imports. It wires network restrictions, security headers, cookie authentication, role/origin checks, authorization, API routing and the SPA fallback.

Browser requests follow this path:

`React page → shared Axios instance (/api) → controller → service/DbHelper → NHibernate → database`

Production serves the React assets from `wwwroot`. Development uses Vite on port 5007 and proxies `/api` to port 5000. Release builds run the frontend build before static-asset discovery. Windows installers and portable packages support the embedded PostgreSQL bundle; Docker uses an external PostgreSQL service.

## Statement import flow

1. Manual upload or the watch-folder service selects an account and invokes `StatementImportService`.
2. The importer validates file bytes/extensions and checks a SHA-256 hash for an exact duplicate within that account.
3. It preflights PDFs, writes a GUID-named file and persists upload metadata.
4. `TextService` selects an `IBankParser` through `BankParserRegistry`. PDFs first pass through `PdfStatementReader`, which converts positioned words into normalized table rows.
5. Parsers produce `BankTransaction` objects. `CounterPartyService` resolves merchants in a batch and `RuleEngineService` applies user rules.
6. Transactions are upserted. Existing rows preserve their original upload association. Credit-card PDFs additionally provide dues, limits and billing dates through best-effort summary extraction.
7. Parse exceptions trigger cleanup of upload metadata and the stored file.

The actual registry supports HDFC TXT/PDF, IOB TXT/PDF, and HDFC credit-card CSV/PDF. CSV support is not universal across all listed banks. Scanned image-only PDFs require a usable text layer; the current extraction path is not an OCR pipeline.

## Domain model and accounting rules

- `Account` carries user ownership, bank identity, card metadata and watch-folder settings.
- `BankTransaction` uses the composite identity `(AccountId, BankReference, BankType)`, rather than a surrogate transaction ID. These fields must remain consistent across parsing, links and deduplication.
- `Merchant` supplies category defaults; transaction category/subcategory overrides take precedence.
- `TransactionSplit` allocates one debit among categories. This is distinct from `SplitGroup` and `SplitGroupMember`, which track shared bills and participant repayments. `BillGroup` supplies reusable participant groups.
- `TransferGroupId` links confirmed transfers between owned accounts. `ExcludeOwnMoneyMoves` excludes those links and parser-marked `TRANSFER` rows from financial analytics.
- `EffectiveDateCalculator` can attribute a flagged merchant's transactions on or after day 25 to the first day of the next month. Analytics frequently use `EffectiveDate ?? TransactionDate`.
- Budgets, bills, deposits, goals, tags and categorization rules supply the surrounding personal-finance features.

GPay detection scores patterns such as distinct senders, Google Pay VPA handles, similar repayment amounts, nearby parent expenses and split keywords. Self-transfers and refund gateways reduce confidence. These are suggestions inferred from transaction evidence, not proof of a shared bill. Takeout imports add another source of split/group information.

## Frontend organization

`index.html` loads `main.js`, which registers a minimal service worker and dynamically loads `main.jsx`. Providers supply themes, authentication, account selection and privacy settings. `App.jsx` gates setup/login and defines the authenticated layout and page routes.

The layout owns shared account selection and page filter state, passing page-specific filters through React Router outlet context. Pages fetch data through the app Axios instance and endpoint wrappers. Privacy masking is a presentation feature. The service worker deliberately does not cache responses, so installability does not imply offline functionality.

`Client/server/index.js` is an optional Express mock API with JSON-file storage. It is not equivalent to the authenticated ASP.NET Core backend and is not the main production data path.

## Findings

### 1. Shared-expense accounting differs between screens

The current dashboard subtracts settled member `PaidAmount` and group `SettledAmount` from aggregate totals. Trends instead suppress linked repayment transaction credits and deduct parent offsets per transaction. `ReportService` and `AnnualSummaryService` still sum gross debits and credits without these repayment adjustments; budgets also do not use `SplitGroupHelper`.

A bill of ₹1,200 with ₹900 reimbursed can therefore appear as ₹300 spending in adjusted views and ₹1,200 spending plus ₹900 income in gross reports. Dashboard and trends can also diverge when a recorded member amount differs from the linked bank credit. Dashboard top merchants still aggregate gross debit values.

Recommended next work: establish one shared accounting projection for totals, categories, merchants, time series and drill-down lists, then verify it with concrete split/repayment examples.

### 2. GPay watch configuration crosses user boundaries

`GPayTakeoutService.GetConfigFilePath()` returns one instance-wide `Data/gpay-auto-import.json`. Configuration writes accept a user ID but use the same file. The background sweep selects the first `AppUser` by ID and calls `SweepAsync` for that user.

Consequently, one user's settings can overwrite another's, and background imports are assigned to the first database user rather than a configuration owner. This conflicts with the application's otherwise user-scoped data model. Store configuration per user and explicitly associate each background import with its owner.

### 3. Frontend lint is failing

ESLint reports 64 problems: 61 errors and 3 warnings. Examples include synchronous state updates inside effects, unused imports/variables and hook dependency warnings. This is a development-quality check failure; it does not mean every flagged pattern causes a runtime defect.

### 4. No automated test suite was found

There is no backend test project or frontend test script in the inspected repository. The PDF extraction CLI harness helps diagnose layouts, but is not a regression suite. Parser fixtures, tenant isolation, duplicate imports and accounting consistency would benefit most from targeted tests.

### 5. Imports span multiple transactions and filesystem operations

Merchant resolution, upload persistence and transaction persistence occur in separate stages. Cleanup after extraction failure removes upload records and the file, but does not make the entire pipeline atomic or undo every preceding merchant/rule side effect. The hash check is also separate from insertion; concurrent import behavior needs verification against database constraints and the private upsert implementation.

### 6. Frontend bundle is sizeable

The verified production build emits a main JavaScript chunk of approximately 1.43 MB, or 395 KB gzip. `App.jsx` eagerly imports the page modules. Route-level lazy loading is a reasonable future optimization if startup performance becomes an issue.

## Verification and limits

- Backend build passed with zero warnings and zero errors using `dotnet build --no-restore -p:UseAppHost=false -o .analysis-build` after the sandbox initially denied writes to existing output files.
- Frontend production build passed using the local Vite CLI with an isolated `.analysis-client-build` output directory.
- Frontend ESLint completed and failed with 61 errors and 3 warnings.
- The ordinary npm command failed because its user-level launcher referenced a missing `npm-cli.js`; invoking installed local CLIs directly allowed validation without changing dependencies.
- No application server was started, no user database was migrated or modified, and no live banking data was imported for this review. Runtime authentication, migration, PDF fixtures and backup restore remain unverified.
- Existing uncommitted source changes were preserved. Verification outputs remain in `.analysis-build` and `.analysis-client-build`.

## Useful starting points for future changes

Read `Program.cs` for host integration; `NHibernateHelper.cs`, mappings and migrations for persistence; `StatementImportService.cs` and `TextService.cs` for imports; `CounterPartyService.cs` and `RuleEngineService.cs` for categorization; dashboard/trends/report services for financial calculations; and `GPaySplitService.cs`, `GPayTakeoutService.cs`, `SplitGroupHelper.cs` and `Client/src/pages/Splits.jsx` for the current shared-expense work.
