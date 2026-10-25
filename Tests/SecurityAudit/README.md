# Disposable security checks

All credentials in this fixture are public synthetic test values. Do not deploy
this Compose file publicly or point the HTTP script at an existing installation.
The stack binds only localhost:18089 and uses a separate Compose project.

```powershell
dotnet run --project Tests/SecurityAudit -p:ValidationBuild=true
docker build -t bankstatementanalytics:security-check .
docker compose -p bsa-security-audit -f Tests/SecurityAudit/compose.yml up -d --wait --wait-timeout 120
pwsh -File Tests/SecurityAudit/cloud-http.ps1 -DisposableTest
docker compose -p bsa-security-audit -f Tests/SecurityAudit/compose.yml down --volumes
```

The final command deletes only this disposable stack's test data. The app's
normal Compose configuration and live server are not used. Import tests separately
create their own temporary database: `dotnet run --project Tests/ImportReliability
-p:ValidationBuild=true`. Real Google callbacks and encrypted backup recovery are
outside this fixture's current coverage.
