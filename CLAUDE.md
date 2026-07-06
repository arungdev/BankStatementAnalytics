# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

BankStatementAnalytics is a personal finance app that parses bank statement exports (HDFC, HDFC Credit Card, IOB) into structured transactions, categorizes them by merchant/counterparty, and serves trends/insights. It's an ASP.NET Core (net10.0) backend that serves a React (Vite) SPA as static files, backed by a local SQLite database via NHibernate.

- `BankStatementAnalytics/` — the ASP.NET Core Web API host (controllers, parsers, NHibernate mappings, models).
- `Client/` — the React 19 + Vite frontend (pages: Transactions, Trends, Insights, Merchants, Upload).
- `Common.Framework/` — a **git submodule** (separate repo: `gsarun125/Common.Framework`) providing `DbHelper`, `NHibernateManager`, and `Logging`. Treat it as a shared library, not app-specific code — changes there affect other consumers.
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

Cloning fresh: `Common.Framework` is a submodule, so use `git clone --recurse-submodules` or `git submodule update --init` afterward, or the backend won't build.

## Architecture

### Request flow
`Program.cs` wires everything: MVC controllers, CORS for the Vite dev origins, a global exception-logging middleware, and NHibernate init (`NHibernateHelper.SessionFactory` forces schema creation at startup). API controllers are attribute-routed under `api/*` (`app.MapControllers()`); any non-API route falls back to `index.html` (`app.MapFallbackToFile`) so the React router handles client-side navigation in production.

### Data layer
- NHibernate (not EF) with SQLite, mapping-by-code (see `BankStatementAnalytics/Mappping/*Map.cs` — note the misspelled folder name, that's intentional/existing).
- `Common.Framework.Data.NHibernateManager.Initialize(dbPath, addMappings, seedData)` is generic/reusable; `NHibernateHelper` (app-specific) supplies this app's mappings and seed logic (default categories/subcategories, default tags) on first run. The DB file lives at `<exe-dir>/Data/DataBase.db` — resolved via the actual process executable path (not `AppContext.BaseDirectory`) to survive single-file self-extraction.
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

### Frontend structure
- `App.jsx` defines routes and a shared `Layout` that lifts filter state (date range, account selection, group-by) per page (`Insights`, `Trends`, `Transactions`) so the sidebar/page header filter controls and the page body share state via `react-router`'s `Outlet` context rather than prop-drilling through routes.
- `src/api/client.js` is a single axios instance with `baseURL: "/api"` — in dev this relies on Vite's proxy or the two servers sharing an assumed relative path; confirm proxy config in `vite.config.js` before changing API base paths.
- `src/context/AccountContext.jsx` holds the globally selected account (used across Transactions/Trends/Insights).
- Charting uses both `chart.js`/`react-chartjs-2` and `recharts` — check which a given page already uses before adding a new chart library dependency.

## Notes
- Logging goes through `Common.Framework.Logging.Log` (log4net-backed, configured via `log4net.config`), not `Console`/`ILogger` — controllers/services catch exceptions and call `Log.Exception(ex)` before returning `StatusCode(500, ...)`.
- JSON serialization is configured with `ReferenceHandler.IgnoreCycles` and `JsonStringEnumConverter` globally (`Program.cs`) — bear this in mind when serializing NHibernate entities with bidirectional navigation properties.
