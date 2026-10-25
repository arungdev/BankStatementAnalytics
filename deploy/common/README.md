# Common.Framework deployment module

Reusable Windows-to-Ubuntu SSH deployment, Docker operations and optional .NET
hosting modules. Product business logic and database mappings remain in each app.

## Integration in the next project

1. Create that project's `docker-compose.yml` with its real framework/database
   versions, volumes, non-root runtime and health check. Use APP_IMAGE, APP_VERSION,
   APP_DOMAIN and ACME_EMAIL variables for its deployment settings.
2. Copy the small launcher/wrappers from an existing consumer's deploy folder and
   create `deploy/project.env`. Configure the image, tag, remote folder, Compose
   app/DB services, DB name/user, host port, persistent directories, health URL,
   HTTPS profile and supported server architecture. Do not put secrets in this file.
3. Run `./Common.Framework/Deployment/Export-Deployment.ps1 -ProjectRoot .` from
   PowerShell. Commit the generated deploy/common folder in the consumer repository.
   End-user packages include deploy-ssh.bat, docker-compose.yml and the deploy folder.
4. Include the required C# sources from deploy/common/Source in the application's
   project, or link the canonical sources directly when consuming framework source.
   ContainerHosting requires ASP.NET Core; PlatformFontResolver additionally requires
   PDFsharp 6.2; DesktopInstallerGuard requires ASP.NET Core and takes a Windows-service
   detection callback, so it does not depend on a particular service package.

For example:

```xml
<Compile Include="../deploy/common/Source/ContainerHosting.cs" Link="Common/ContainerHosting.cs" />
```

```csharp
ContainerHosting.LoadDatabasePasswordFile(); // before configuration is built
app.UseConfiguredProxy(app.Configuration);   // before cookies/auth/origin checks
app.UseLocalReadiness(async ct => await CheckDatabaseAsync(ct));
```

The readiness callback supplies product/provider-specific checks. Forwarded headers
trust only the explicit Deployment:KnownProxy IP. The password loader supports custom
environment variable names and escapes connection-string passwords correctly.
Register PlatformFontResolver once in PDFsharp. Install DejaVu fonts in Linux images.

RootedFileStore supplies relative-path confinement and deletion of empty parent
folders; Windows comparisons ignore case, Linux comparisons respect it. Its root
must be application-controlled and must not contain untrusted symlinks.
ProtectedValueStore wraps Data Protection with explicit key directory, application
name, purpose and stored-value prefix. Preserve those identifiers and key files
when migrating an existing consumer. ServerFolderBrowser supplies cross-platform
folder-picker roots; the product still owns authentication and its API endpoints.

## Deployment contract

The module also includes publish-image.ps1 (build locally, or build/push when a
repository and unique tag are supplied) and package-deployment.ps1 (ZIP the public
deployment files only). Caddy's shared template reads APP_DOMAIN, ACME_EMAIL and
APP_UPSTREAM, so each consumer configures its own service address in Compose.
The shared log4net template writes bounded rotating files and console logs; copy it
to the consumer's existing log4net.config location when exporting a release.

The Compose application service mounts its persistent directories under DATA_ROOT,
has curl available for readiness checks, and reads /run/secrets/db_password (when
needed). Compose's secret source is secrets/db_password.txt. Its HTTPS profile
contains the product's proxy configuration. Host HTTP is bound to loopback only.

Built-in DB backups target PostgreSQL: DB_SERVICE, DB_NAME and DB_USER identify a
service with pg_dump, pg_restore, dropdb and createdb available. Leave DB_SERVICE empty
for file-only applications. MySQL/SQL Server require provider-specific backup hooks;
do not use PostgreSQL restore commands for them. DATA_DIRECTORIES is a comma-separated
list of simple folder names; DATA_ROOT must be an absolute container directory.

Config is parsed as literal KEY=value, never evaluated as shell code. Backups pause
the single application instance while taking DB/files snapshots. Restore explicitly
requires --replace-current-data, validates folder names and leaves the app stopped
on failure. Keep older images and snapshots for rollback after schema migrations.

Ubuntu setup installs Docker only when absent and does not modify firewall rules or
host-key verification. The remote login must have sudo access (root works directly).
Existing Docker installations must already have Compose. The module supports the
architecture explicitly listed in project.env; publish a matching image first.

## Maintaining the module

Edit this canonical directory, run Export-Deployment.ps1 for each consumer, verify
the generated manifest with the consumer's scripts/verify-common-deployment.ps1,
then run that consumer's tests. Generated copies should not be edited independently.
The existing Common.Framework.dll is not rebuilt: some consumers' vendored binary
contains newer APIs than the local legacy source. Deployment modules are deliberately
source-distributed to avoid replacing that binary or imposing optional PDF packages
on framework consumers who do not use them.
