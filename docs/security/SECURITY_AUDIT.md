# Security audit and implementation — 25 October 2026

Scope: application APIs/services, legacy framework source and actual vendored DLL
contract, React client, imports, persistence, backup and Docker deployment. This
document records evidence and will be updated with implementation/test results.
Existing financial records and the live VPS are excluded from destructive tests.

## Initial findings and prioritized plan

| Component | Evidence / risk | Severity | Recommended fix | Verification |
|---|---|---|---|---|
| GPay primary configuration | GetConfigFilePath is shared by every user; background sweep assigns it to first user | Critical | Store primary configs with OwnerUserId; legacy config belongs only to original user | Two-user reads/updates/sweeps |
| Server-file imports / watch folders | preview-path and import-takeout-path read arbitrary existing files; account watch paths unrestricted | High | Public hosting disables host filesystem operations, including old background watch configs | Denied API actions and background gating |
| Account creation | Binds Account entity, accepts SharedLimitAccountId/watch metadata and stores full AccountNumber | High | Allowlisted DTO, owned FK validation, number masking | Forged owner/id/related-account tests |
| Session authentication | Vendored auth uses cookies without server-side ticket revocation; old cookies lack password/role validation | High | Standard ITicketStore + Data Protection, per-request active/hash/role validation, absolute expiry | Replay after logout/reset/disable/restart |
| Password policy | Source ValidatePassword accepts any nonblank password; actual DLL requires runtime verification | High | Enforce bounded strong passwords before inherited auth actions | API tests with real DLL |
| CSRF / CORS | Origin allowlist includes any loopback and LAN origins; RoleGateExempt and anonymous writes skip role-gate CSRF | High | Global unsafe-method origin enforcement; dev-only explicit CORS | Cross-origin login/logout/admin requests |
| Takeout archives | Expanded limits exist but entry count, traversal names and streamed byte reads are not bounded | High | Entry/name/count/actual-byte limits; bounded input buffering | Synthetic malformed and excessive archives |
| Rules engine | User regex executes without timeout | High | Bound pattern length/execution and fail closed | Catastrophic-backtracking regression |
| Browser instance backup | Admin-only confirmed via actual DLL; exports all tenants and keys; restore unlimited | High | Disable browser instance operations in public hosting; operator encrypted backups | Normal/admin endpoint denial |
| GPay evidence errors | Raw validation exception messages can include attacker-controlled paths/content | Medium | Bounded/sanitized API errors and generic unexpected failures | Error response inspection |
| CSV export | Escaping quotes does not neutralize spreadsheet formulas | Medium | Prefix untrusted formula-like text | CSV formula payload tests |
| Test notification | GET mutates financial reminders, exposed in production | Medium | Remove GET and deny development helpers outside Development | GET/production tests |
| Search | Merchant lookup includes ownerless records for every user | Medium | Strict tenant ownership | Legacy-ownerless disclosure test |
| Docker database | POSTGRES_USER is the initial database superuser | High | Separate non-superuser application role and operator role; migration instructions | PostgreSQL role tests |
| Backups / disks | Current operator snapshots and volume data are not encrypted by this application | High | Encrypted backup path and documented disk/key protection; no browser plaintext export publicly | Isolated backup/restore + operator checks |

Implementation order: tenant/file boundaries; auth/session/CSRF; bounded imports
and resource controls; Google sign-in with explicit account linking; deployment
hardening/backup encryption; automated multi-user HTTP tests; final risk register.

Administrator-assisted password recovery was selected by the user. Google login
is an optional addition and must not link an existing account solely by email.
Google credentials and provider-console configuration are external prerequisites.

## Sources

- [ASP.NET cookie validation](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/cookie?view=aspnetcore-10.0)
- [ASP.NET Google authentication](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/social/google-logins?view=aspnetcore-10.0)
- [OWASP authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP file uploads](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

Status: audit/implementation in progress. Production readiness is not established
by this initial review. Runtime verification and remaining risks follow below.

## Cloud and multi-user verification

See [CLOUD_SECURITY.md](CLOUD_SECURITY.md) for implemented behavior, reusable
framework modules, configuration and migration prerequisites. New cloud imports
retain financial records and metadata without writing original files. Synthetic
tests passed: 46 import/ownership/cloud checks, 118 GPay checks, 20 shared-bill
checks, 11 shared security checks and 14 Linux/PostgreSQL HTTP checks. The frontend
and local Linux Docker image builds passed. A fresh isolated Docker database used
a non-superuser application role and the application reached healthy status.

HTTP checks verified separate logins, own-account listings, cross-origin rejection,
public registration/backup denial, logout revocation and independent sessions.
They are not exhaustive endpoint or concurrency coverage. Compatible dependency
updates for V4 produced a zero-vulnerability npm audit and a .NET package scan with
no vulnerable packages reported by the current feeds. Full password-reset and
role-change replay tests, Google provider callbacks, encrypted backup recovery,
container/base-image vulnerability scans, host disk encryption and production
firewall/TLS review remain unverified. No live data was used or removed. Historical
retained originals remain untouched. Publication status and digest are recorded by
the release coordinator in the versioned Setup release JSON. No live-server
deployment is performed by the build.
