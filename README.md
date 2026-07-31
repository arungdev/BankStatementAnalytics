# BankStatementAnalytics

A personal-finance app that parses bank statement exports (HDFC, HDFC Credit Card,
IOB — PDF, CSV, and text) into structured transactions, categorizes them by
merchant, and serves trends and insights. It's an ASP.NET Core (net10.0) Web API
that serves a React (Vite) SPA, backed by PostgreSQL (an embedded, bundled
instance by default, or your own server via `appsettings`).

## Features

- **Statement import** — upload HDFC / HDFC Credit Card / IOB statements as PDF
  (password-protected supported), CSV, or text; parsed transactions are deduped
  and upserted. A watch-folder service can auto-import statements dropped into a
  configured directory.
- **Categorization** — transactions link to merchants (counterparties) that carry
  default categories; per-transaction overrides, inline tags, and notes.
- **Merchants** — merge/alias same-named counterparties, UPI-id matching, inline
  categorization from list rows.
- **Analytics** — Overview dashboard, Trends, Insights, and Reports pages, with
  PDF report export.
- **Budgets** — monthly limits per category, with suggested limits derived from
  spending history.
- **Bills & reminders** — recurring-bill tracking, including unpaid credit-card
  bills.
- **Credit cards** — statement summaries, utilization, billing cycles, and due
  reminders.
- **Investments** — fixed-deposit tracking with maturity projections.
- **Multi-user** — first-run admin setup, login, and per-user data isolation.

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

## Quick start

Backend (from `BankStatementAnalytics/`):

```
dotnet restore
dotnet build      # builds against the vendored lib/Common.Framework.dll
dotnet run        # configure a PostgreSQL connection in appsettings first
```

Frontend (from `Client/`, separate terminal — in Debug the API does not build or
serve the SPA):

```
npm install
npm run dev       # Vite dev server (optional: copy .env.example to .env to override the API origin)
```

`npm run lint` runs ESLint; `npm run build` outputs the production bundle into
the API's `wwwroot/`.

## Builds & deployment

- **Single-file EXE** — `build.bat` (repo root) publishes a self-contained
  win-x64 executable to `Publish\`, bundling the built SPA (and the embedded
  PostgreSQL runtime when available).
- **Windows installer** — `build-installer.bat` compiles an installer into
  `Setup\` that installs the app as a Windows service. Requires the private
  `Common.Framework` repo (author only).
- **Docker** — `docker-compose up --build` serves the app on port 8080 with
  named volumes for the database and uploads; `docker-release.bat` builds the
  release image.

> Updating the vendored DLL (author only): rebuild `Common.Framework` and copy its
> `bin/Release/net8.0/Common.Framework.dll` back into `BankStatementAnalytics/lib/`.

Notes

- Uploads are saved to the `Uploads/` folder by default (git-excluded).
- Real bank statements used for parser tuning live in `samples/` (git-excluded — they contain account numbers).
- Keep secrets in environment variables or user-secrets; do not commit credentials.

## License

This project is **source-available**, licensed under the
[PolyForm Noncommercial License 1.0.0](LICENSE.md).

You are free to use, modify, and share the code **for any
noncommercial purpose** (personal projects, study, hobby use,
non-profits, education, research). **Commercial use is not
permitted** without a separate license from the author.

Note: this is *not* an OSI-approved "open source" license, because
it restricts use to noncommercial purposes. The third-party
dependencies (React, ASP.NET Core, NHibernate, etc.) and the
vendored `Common.Framework` library keep their own separate licenses.
