---
name: verify
description: How to build, launch, and drive an isolated instance of BankStatementAnalytics for end-to-end verification.
---

# Verifying BankStatementAnalytics changes end-to-end

The writable data root (embedded Postgres, DB, uploads, keys) is **the directory containing the exe** (`AppPaths.ResolveWritableAppDataDirectory`). So building into a throwaway directory gives a fully isolated instance with its own fresh database — no risk to the user's real data.

## Recipe

1. **Build into an isolated dir** (also proves compile; avoids the locked `bin\Debug` exe if an instance is running):
   ```
   dotnet build BankStatementAnalytics\BankStatementAnalytics.csproj -o <scratch>\build-check
   ```
   The `pgsql\` embedded Postgres bundle is copied automatically.

2. **Serve the SPA (optional, for UI verification):** `npm run build` in `Client/` outputs to `BankStatementAnalytics/wwwroot`. Copy that folder next to the isolated exe as `wwwroot` **before** starting (webRoot is resolved once at startup).

3. **Start it:** `./BankStatementAnalytics.exe --urls http://localhost:5199` (run in background). Use `--urls` — `ASPNETCORE_URLS` env var loses to `appsettings.Development.json` (`Urls: http://localhost:5000`, often already taken). First boot takes ~25s (embedded Postgres initdb). Logs: `server.log` (stdout), `Logs/applog.log` (log4net), `Data/pgsql.log`.

4. **Auth (cookie-based):** fresh DB needs first-run setup:
   ```
   curl -c cookies.txt -X POST :5199/api/auth/setup -H "Content-Type: application/json" \
        -d '{"username":"verifier","password":"Verify@12345"}'
   ```
   Then pass `-b cookies.txt` on every request. Unauthenticated calls get 401.

5. **Seed data:** create accounts via `POST /api/accounts` (`{"accountHolderName","accountNumber","bankName":"HDFC|IOB|HDFCCreditCard"}`), then upload a sample statement: `POST /api/statements/upload` multipart with `file` + `accountId`. Sample HDFC/IOB statements live in `BankStatementAnalytics/Uploads/`.

6. **Direct DB access:** `<build-check>/pgsql/bin/psql.exe -h 127.0.0.1 -p $(cat Data/pgsql.port) -U postgres -d bankstatements` with `PGPASSWORD=$(cat Data/pgsql.secret)`. Tables are lowercase (e.g. `bank_transactions`).

7. **Drive the UI:** `npm i playwright` in a scratch dir and launch with `channel: 'msedge'` (no browser download needed). Login placeholders: "Enter your username"/"Enter your password"; the Settings modal opens via `button[title="Settings"]` in the page header.

## Gotchas

- `bank_transactions.banktype` is `varchar(10)`; NHibernate schema update never widens columns, so stored codes must stay ≤10 chars. Credit card rows store `"HDFCCC"` via `BankTypeCode.For(Bank)` (EnumClass/BankTypeCode.cs) — parsers AND transaction queries must both use that helper, never `BankName.ToString()`.
- Upload failures roll back the Upload row + stored file (no orphan 409s) — fixed Jul 2026; older installs may still have orphan Upload rows from before.
- Kill the background exe when done; it holds the port and the pgsql child process.
