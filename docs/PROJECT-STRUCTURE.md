# Project layout and build workflow

| Location | Purpose |
| --- | --- |
| `BankStatementAnalytics/` | .NET application, database mappings, business logic, installer definition |
| `Client/` | React frontend and its own dependencies |
| `Common.Framework/`, `Common.Client/` | Private shared source checkouts; keep separate from public application code |
| `deploy/` | Application deployment configuration and guides |
| `deploy/common/` | Exported shared deployment scripts; edit canonical source in `Common.Framework/Deployment/`, then run `scripts/update-common-deployment.ps1` |
| `scripts/` | Application build wrappers and maintenance commands |
| `Tests/` | Repeatable application and deployment checks |
| `docs/` | Feature, security, review, dependency and release documentation |
| `Setup/Candidates/<version>/` | Local installer, portable ZIP, cloud ZIP, optional image TAR/offline ZIP and checksums |
| `Setup/Images/` | Previously saved local Docker image TARs |
| `Setup/` | Published release output from explicitly selected publish builds |
| `.build/` | Temporary build stages, test fixtures, logs and internal analysis utilities |
| `.local-docker/` | Private local Docker credentials and development certificate; do not remove during cleanup |
| `Publish/`, `backups/` | Existing runtime/publish data and backups; not general cleanup targets |

The root BAT files are deliberately kept as easy-to-find launchers. Dockerfile, Compose, solution and build configuration stay at the root for normal tooling. Analysis folders, screenshots and dummy data are preserved because they can contain useful inputs or work that is not reproducible.

## Build options

Run `build-release.bat` without arguments for the menu:

1. Choose **Build one standalone app EXE** for a single self-contained app file in `Publish/`, **Build packages** for installer and deployment archives, or **Update installed app** to build a local installer and run it elevated for the default Program Files installation.
2. For package builds, choose a local build or build and publish to Docker Hub. The update option always uses a local build.
3. Keep the current version, find the next unused version when publishing, or enter a version such as `4.0.0`.
4. Choose whether to create an offline cloud ZIP with its Docker image.
5. Optionally save a standalone Docker image TAR, then review the choices and start the build.

Release package builds create the Windows installer EXE, portable ZIP and online cloud setup ZIP. Local builds never push. Publishing uses the existing Docker login and never overwrites an already published version when Keep/custom version is selected. Automatic version selection advances to an unused patch version.

Command-line options remain available:

```bat
build-release.bat -SkipPush
build-release.bat -SkipPush -Version 4.0.0 -Offline
build-release.bat -SkipPush -ExportImage
build-release.bat -Publish
build-release.bat -Publish -Version 4.1.0 -KeepVersion
```

For daily local Google login testing, use `Local-Docker.bat` instead of building installers. See [local Docker instructions](../deploy/LOCAL-DOCKER.md).

## Cleanup policy

Completed `.build/releases/` staging directories and synthetic test fixtures may be removed after all build/test processes finish and final outputs are present in `Setup/`. Keep active build directories, `.local-docker`, Docker database volumes, backups, private repositories, source, vendored libraries and financial inputs.

The latest cleanup report is stored locally at `.build/cleanup-report.json`. Cleanup does not prune Docker images/volumes or uninstall dependencies.
