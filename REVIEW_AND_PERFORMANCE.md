# Review and performance improvements — 11 October 2026

Reviewed application startup, routing, shared request handling, global search,
notification polling, transaction filtering, build configuration, and existing
regression coverage. This is a targeted source review, not an exhaustive audit
of every page or the private vendored dependencies.

## Changes

- Global search and anomaly links now populate the transaction search textbox.
  Global transaction hits preserve their account scope. URL changes also update
  the search when the Transactions page is already mounted.
- Search and onboarding dialogs load on demand. The production build emits
  separate approximately 10 KB and 4 KB JavaScript chunks for these dialogs.
- Global search uses one NHibernate session for ownership and results, forwards
  request cancellation to database queries, and uses deterministic ordering.
- Import-failure polling prevents concurrent requests when a server response
  takes longer than the polling interval.
- Shared guarded requests cancelled before their scheduled start no longer
  initiate transport work, including immediate React effect cleanup.

## Verification

- Backend validation build: zero warnings/errors.
- Frontend ESLint: zero warnings/errors.
- Frontend Node regression suite: eight checks.
- GPay matching/profile isolation/pagination: 118 checks.
- Shared bill regression suite: 20 checks.
- Import reliability/search regression suite: 36 SQLite checks.
- Vite production build succeeded in an isolated output directory.

The local npm launcher points to a missing npm-cli.js; validation used the
installed ESLint/Vite CLIs through Node instead. No dependencies were changed.
Production output and the application's normal database were not modified.

## Remaining validation

No production-data benchmarks, browser interaction tests, or PostgreSQL run were
performed. Reduced request/connection work and deferred dialog code are verified
structurally; no measured latency improvement is claimed. Large-ledger query
profiling should use representative anonymized data and execution plans before
adding indexes or changing accounting queries. The older PROJECT_ANALYSIS.md
describes the 3 October tree; its claims about missing tests, lint failures, and
eager page imports do not describe this reviewed tree.
