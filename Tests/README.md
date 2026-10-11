# Regression checks

From the repository root, run each executable (a nonzero exit means failure):

```powershell
dotnet run --project Tests/GPayMatching -p:ValidationBuild=true
dotnet run --project Tests/SharedBills -p:ValidationBuild=true
dotnet run --project Tests/ImportReliability -p:ValidationBuild=true
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
