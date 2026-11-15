# PostgreSQL schema tenancy implementation plan

## Analysis

The application uses NHibernate 5.6.1, Npgsql 8.0.3 and a vendored Common.Framework DLL. The private framework checkout is older than that DLL; replacing it would remove migration APIs used by the application. Shared authentication and financial mappings currently use one global session factory, with application ownership checks. Existing migrations include data updates against unqualified shared tables. Background import, startup recovery, user provisioning, raw SQL, file storage and mixed authentication/financial queries all need explicit handling.

## Design and implementation sequence

1. Add optional, application-independent source modules under Common.Framework/Deployment/Source, exported through the existing shared-module mechanism. Preserve the vendored DLL ABI.
2. Use a protected control schema with server-side subject/membership mapping, transactional provisioning and PostgreSQL advisory locks. Each tenant receives a generated schema and distinct LOGIN role, without schema ownership, CREATE, role membership, shared-schema access or administrative privileges. Migration credentials remain separate from tenant credentials. Tenant passwords are protected with the application's persistent Data Protection key ring.
3. Resolve identity exclusively from authenticated claims and stored membership. Request bodies, query parameters and headers cannot select a schema. Use fresh connections with role-specific pooling and a fixed trusted search path. Disable ORM shared/query caching. Hold shared advisory locks for data sessions and exclusive locks for lifecycle operations.
4. Register ordered application migration steps with stable IDs/checksums. Run DDL and version tracking transactionally under distributed locks. Application-specific schema creation and legacy row selection remain outside the framework.
5. Route financial operations through tenant-aware sessions, leaving authentication shared. Provision on account creation; scope startup recovery, background work and seeding explicitly. Keep the feature disabled by default and require PostgreSQL plus separate operator credentials.
6. Add a stopped-writes legacy migration command that copies each user's financial graph, preserves IDs, checks row equality/counts and resets sequences. Keep the shared source data for rollback. Never run this migration automatically on a live server.
7. Provide tenant-bound encrypted logical snapshots and transactional restoration, with strict table/version validation and no arbitrary SQL execution from backup content. Document file/key-ring handling separately.
8. Test actual PostgreSQL privileges with at least two users, including schema-qualified attacks, pooling, NHibernate identity collisions, distributed provisioning/migrations, failure recovery and single-tenant restore. Retain legacy application regression tests.

## Operational boundaries

This is logical database isolation, not separate PostgreSQL instances or protection from a compromised application host/database administrator. The control-plane operator is privileged and must never be exposed through a tenant SQL connection. PUBLIC privileges must be hardened explicitly on a dedicated application database; do not apply that step blindly to databases shared with unrelated applications.

Per-tenant roles/pools consume catalog entries and connections. Keep minimum pool sizes zero, per-role pool limits small and ORM metadata factories shared or bounded. Thousands of schemas require measured catalog growth, migration scheduling, total connection limits and operational monitoring. No scalability claim is made without load testing. Large deployments may be better served by shared tables with RLS or database-per-tenant isolation.

## Rollout

Back up the database, uploads and Data Protection keys; rehearse on a disposable restored copy; stop all writers; run explicit migration and verification; enable tenancy on all application servers together. Do not mix old shared-schema writers with migrated tenants. Rollback requires stopping new writers and restoring a consistent pre-cutover backup; retained legacy rows alone do not contain post-cutover changes.

## Implemented components

The generic implementation lives in `Common.Framework/Deployment/Source/PostgresTenant*.cs`, exported into `deploy/common/Source` by `scripts/update-common-deployment.ps1`. The independent `Common.Framework/PostgresTenancy` .NET 8 project can be referenced by other applications. The existing vendored framework DLL is preserved. Generic contracts, registry, memberships, role provisioning, NHibernate sessions, migrations and snapshots contain no financial models or application table names.

The application adapter is `BankStatementAnalytics/Tenancy`. Shared authentication stays in `public.users` and `public.external_logins`; financial sessions use a generated schema and database role. HTTP middleware, startup recovery, imports, seeding and background sweeps enter explicit tenant scopes. Uploads use generated tenant-ID directories. Statement encryption keys retain their existing global location so old encrypted statement passwords remain readable. Shared/query ORM caches are disabled; application cache keys include the tenant ID.

The baseline SQL is a frozen embedded migration. Do not regenerate or edit an applied baseline when adding models: add a new ordered migration with its own checksum. A changed/removed applied migration fails closed. Provisioning and schema migrations use transactional distributed PostgreSQL locks. Normal sessions hold shared tenant locks; backup, restore and lifecycle operations acquire exclusive locks. Dispose every session/connection lease promptly.

## Configuration and prerequisites

The feature is **disabled by default**. Existing SQLite, embedded PostgreSQL and ordinary local/cloud installations keep their existing behavior. Opt-in requires external PostgreSQL 15 or newer (tested with 16), a dedicated database and two separate credentials:

- `Database:PostgresConnectionString`: restricted shared authentication role, without database ownership or administrative privileges.
- `Tenancy:OperatorConnectionString`: trusted operator with schema/role provisioning and migration permissions. It also needs permission to suppress PostgreSQL statement/error parameter logging during credential DDL. A managed provider that denies those settings needs a separately implemented provisioning service; do not fall back to privileged tenant connections.
- `Tenancy:OperatorPasswordFile`: optional secret file overriding the operator password. Keep secrets outside images and source control.
- `Tenancy:Enabled=true`, `Tenancy:MetadataSchema=cf_tenancy`, `Tenancy:MaximumPoolSize=2`.
- `Tenancy:MaximumSnapshotBytes`: default 33554432 in this application. Snapshots are buffered; one backup/restore runs at a time per store instance. Budget additional memory for JSON and encryption overhead.

Environment variables use double underscores, for example `Tenancy__Enabled=true`. Persist the existing Data Protection key directory and application discriminator (`BankStatementAnalytics.Auth`), statement keys, uploads and authentication sessions. Losing the key ring prevents credential decryption and snapshot restoration. Multiple application servers must share compatible key/session storage; the module does not distribute those files automatically.

`deploy/schema-tenancy-compose.yml` adds the operator secret and feature flags to the existing Compose deployment. It does not convert an existing database role automatically. Never expose PostgreSQL publicly.

## Local rehearsal

Stop the ordinary local Docker application to release port 8443, then run:

```bat
Local-Docker.bat -SchemaTenancy
```

This uses a separate Compose project, image tag and `.local-docker/schema` configuration. Existing normal local Docker volumes are not migrated or reused. It builds current source, initializes a fresh database with separate operator/authentication roles, performs the explicit cutover command, and starts localhost HTTPS. Use the same Google localhost redirect configuration described in `deploy/LOCAL-DOCKER.md`. No image publication or version bump is required.

## Existing installation cutover

Rehearse these steps on a restored disposable copy first. They require an operator who understands the existing PostgreSQL role ownership. An old installation whose application role is a superuser must have that role safely demoted and ownership transferred before cutover; never demote the only remaining database administrator.

1. Take and verify an off-server full database backup plus uploads, statement keys, Data Protection keys and session configuration. Record the previous image digest and configuration.
2. Stop **all** application instances, import workers and other writers. Bring the legacy database to the current supported shared schema first. Do not allow old and new writers concurrently.
3. Configure the restricted authentication role and separate operator secret. Include the schema overlay in every subsequent Compose invocation. With the database running, run the new image as a one-off operator command:

```sh
sudo docker compose -f docker-compose.yml -f deploy/schema-tenancy-compose.yml run --rm --no-deps -T bankstatementanalytics schema-tenancy migrate --stopped-writes
```

4. The command copies each user's financial graph using audited ownership predicates, preserves IDs, compares rows in both directions, resets sequences and copies only referenced upload files into the private tenant directory. It refuses ambiguous/unowned rows or mismatched columns. Each user's copy is transactional and retry-tracked; copied files may remain after a failed database step, and retries verify their hashes. Original shared rows/files remain intact. A global completion marker prevents serving a partial cutover.
5. Start every instance with the same overlay and inspect health/logs and at least two users' accounts, imports, reports and backups:

```sh
sudo docker compose -f docker-compose.yml -f deploy/schema-tenancy-compose.yml --profile https up -d --no-build --wait
```

Retain any existing Google configuration overlay in both commands. The migration command is for cutover, not routine updates or merging later changes from shared tables. Do not rerun it as a live synchronization job. Existing generic Setup/Update scripts detect schema installations and stop rather than silently dropping the overlay. Routine schema-mode updates require the explicit Compose configuration, a verified backup, a recorded image digest, and startup schema migrations. No production server has been converted by this implementation.

## Backup, recovery and deletion

Authenticated users can POST `/api/workspace/database-backup` and upload that file as multipart field `file` to POST `/api/workspace/database-backup/restore`. These are database-only encrypted snapshots bound to the resolved tenant ID. They cannot restore another user's snapshot. No new backup UI is included. The old whole-instance backup API is blocked in schema mode.

Trusted operators can invoke the app host with:

```text
schema-tenancy list
schema-tenancy backup <user-id> <new-output-file>
schema-tenancy restore <user-id> <snapshot-file>
schema-tenancy repair-roles
```

All commands use the same tenancy configuration and persistent key ring. A user snapshot excludes original upload files, key rings and shared authentication records. Back up those separately. A snapshot restore requires matching registered table sets and schema migration checksums; rehearse recovery before upgrading schemas.

For full disaster recovery: stop all writers; restore a trusted full dump as the operator into an appropriately owned database using `pg_restore --no-owner --no-acl`; restore the original key rings, upload/statement files and configuration; then run `schema-tenancy repair-roles` to recreate tenant credentials/grants and harden shared authentication access. Keep the same metadata-schema name and Data Protection discriminator. Verify health and user isolation before reopening traffic. Generic legacy restore scripts deliberately refuse tenant-containing dumps before dropping a database. Never execute an untrusted SQL dump with operator privileges.

The framework exposes operator-only organization membership, suspension/resumption and suspended-tenant deletion APIs. The application's existing authorized deletion hook clears financial rows, including for inactive users; it is not a schema lifecycle administration UI. Schema/role removal and organization management require an explicit operator workflow. Retained legacy rows and pre-cutover backups also require a separate retention/deletion policy.

Rollback: stop every new writer and restore the consistent pre-cutover database/files/keys and previous image/configuration together. Merely disabling the flag exposes stale retained legacy rows and loses visibility of post-cutover changes; it is not a safe rollback procedure.

## Verification and limits

The disposable PostgreSQL 16 suite passed 28 checks covering generated schemas/roles, identifier injection, anonymous access, explicit memberships, concurrent multi-process provisioning, identical entity IDs, pooled NHibernate sessions, scope revocation, cache namespaces, cross-schema/control-plane/DDL/TEMP/role-switch denial, tampered/cross-user snapshots, migrations with rollback, and suspend/resume/delete. Additional tests rejected operator-owned view leakage and SECURITY DEFINER functions, copied actual financial mappings for two users while retaining source data, and started the real HTTP application with a restricted authentication role to check login, financial ID isolation and tenant backup/restore endpoints.

The optimized multi-stage Docker image built successfully. A non-root Linux application container passed two-user login, financial ID isolation and own/cross-user snapshot checks. A separate fresh HTTPS Compose deployment completed schema cutover, became healthy and produced the correct localhost Google authorization redirect. The Google callback itself requires real credentials and was not exercised in this schema-mode test.

Legacy regressions passed: 118 matching checks, 20 shared-bill checks, 59 import checks on SQLite and 59 on PostgreSQL, and 22 security/real-handler OAuth checks. The independent .NET 8 framework built with zero warnings/errors. Shared-module integrity verified 40 artifacts; runtime ZIP allowlisting and mocked SSH/backup deployment contracts passed. NuGet vulnerability metadata was unavailable during some application builds; those builds completed with NU1900 warnings.

Managed PostgreSQL, multiple physical application servers, full disaster recovery and high-tenant-count load have not been end-to-end validated. Rehearse on a restored copy before enabling this on a real server. This is an opt-in implementation with explicit operational prerequisites, not evidence of unlimited scale or protection from a compromised application/operator. No live server migration, image publication or application version change was performed.
