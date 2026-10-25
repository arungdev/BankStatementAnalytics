# Documentation

- [Security and hosting](security/CLOUD_SECURITY.md)
- [Security audit](security/SECURITY_AUDIT.md)
- [Release notes](releases/RELEASE_NOTES_v4.0.0.md) — earlier versions are in `releases/`.
- [Google Pay implementation](gpay/GPAY_IMPLEMENTATION.md)
- [Google Pay profiles](gpay/GPAY_PROFILES.md)
- [Shared bill insights](features/SHARED_BILL_INSIGHTS.md)
- [Project analysis](reviews/PROJECT_ANALYSIS.md)
- [Review and performance](reviews/REVIEW_AND_PERFORMANCE.md)
- [Vendored dependencies](dependencies/VENDORED_DEPENDENCIES.md)

## Folder guide

| Location | Contents |
| --- | --- |
| `BankStatementAnalytics/` | Backend application |
| `Client/` | Frontend application |
| `Common.Client/`, `Common.Framework/` | Local shared library checkouts |
| `Tests/` | Regression and deployment checks |
| `scripts/`, `deploy/` | Build, release, and deployment tooling |
| `DummyData/` | Sample inputs and data generators |
| `screenshots/` | Application screenshots |
| `docs/` | Documentation grouped by subject |
| `.local-analysis/` | Private analysis notes and loose verification artifacts; excluded from Git and Docker |
| `.analysis-*/`, `.build/` | Existing temporary build and verification directories |
| `Publish/`, `Setup/` | Generated release output |
| `backups/` | Local backups |

Root launchers, solution files, and build configuration remain at the root because existing tooling depends on their paths. Existing generated outputs are retained.
