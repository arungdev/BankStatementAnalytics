# Disposable PostgreSQL tenancy tests

Use PostgreSQL 16 on a fresh disposable database. The suite creates roles/schemas, copies synthetic financial data and starts an application HTTP listener at localhost:51873. Never point it at production or a developer's ordinary database.

```powershell
$env:BSA_DISPOSABLE_TEST='yes'
$env:TENANCY_TEST_CONNECTION='Host=127.0.0.1;Port=55439;Database=tenant_test_fresh;Username=postgres;Password=synthetic-test-only'
dotnet run --project Tests/SchemaTenancy -p:ValidationBuild=true
```

The database must already exist, have a name beginning `tenant_test_`, and be empty. Use a disposable operator with role/schema creation privileges. Each run needs a fresh database. The password above is a generic example; match the disposable database configuration. Tests generate private temporary Data Protection keys, separate process workers and a restricted authentication role. They do not contact Google or a production server. Delete only the dedicated test database/container when finished.

`linux-smoke.sh` repeats the two-user HTTP boundaries inside a disposable Linux app container using this suite's synthetic financial fixture. Use the same temporary Data Protection key directory and `cf_financial_test` metadata schema; invoke the script through container loopback. The separate HTTPS deployment test can run with `Tests/DeploymentReuse/local-docker.ps1 -SchemaTenancy -Image <local-image> -Tag <local-tag>`; it uses a random Compose project, port 18443 and synthetic Google credentials, and removes its own volumes afterward. It checks authorization redirection, not a live Google callback.
