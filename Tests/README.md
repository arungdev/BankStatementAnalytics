# Regression checks

From the repository root, run each executable (a nonzero exit means failure):

```powershell
dotnet run --project Tests/GPayMatching -p:ValidationBuild=true
dotnet run --project Tests/SharedBills -p:ValidationBuild=true
dotnet run --project Tests/ImportReliability -p:ValidationBuild=true
dotnet run --project Tests/LinuxDeployment -p:ValidationBuild=true
dotnet run --project Tests/SecurityAudit -p:ValidationBuild=true
dotnet run --project Tests/SbiStatements -p:ValidationBuild=true
dotnet run --project Tests/UpdateInstallation -p:ValidationBuild=true
```

`ValidationBuild` isolates both intermediate files and binaries under `.build/`
and skips copying the embedded PostgreSQL runtime. This avoids modifying a
running development copy's build output. The tests use synthetic records.

The import suite creates a disposable SQLite database on Windows, plus synthetic
statement files beside its own executable. It exercises migrations with legacy
duplicate uploads, complete/failed/concurrent imports, overlapping periods, user
edits, transaction and merchant rollback, interrupted-import recovery, account
ownership, batched balances, normalized PDF parsers, reconciliation warnings,
password protection, restored keys, and path confinement. It never connects to
the application's normal database.

It also covers account password management, GPay profile preferences, watcher
shutdown and independent caller cancellation, shared tag normalization, and
categorization-rule conditions and priority. SecurityAudit starts a disposable
loopback HTTP listener for synthetic Google-handler checks; it needs permission
to connect to that listener. Schema-tenancy checks require the separately
provisioned disposable PostgreSQL database described in `SchemaTenancy/README.md`.

For PostgreSQL, set `BSA_TEST_POSTGRES` to a disposable database connection string.
The suite refuses database names other than `bsa_regression`. Start with an empty
database for each run; CI provisions a fresh PostgreSQL service. The suite
retains its disposable artifacts for failure investigation.

Frontend checks, from `Client/`:

```powershell
npm ci
npm run lint -- --max-warnings 0
npm test
npm run build
```

The Node tests cover request cancellation and response ordering, failures reaching
the UI, matching CSV/list filters, upload drilldowns, and local-day date presets.
`Tests/SharedBills/report-range.mjs` also checks bill-report period boundaries.
