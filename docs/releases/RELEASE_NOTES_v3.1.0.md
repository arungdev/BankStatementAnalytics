# Bank Statement Analytics - Release Notes v3.1.0

**Release Date:** October 11, 2026  
**Version:** 3.1.0  

---

## Highlights

Bank Statement Analytics v3.1.0 introduces critical improvements for statement import reliability and atomicity, security hardening with encrypted PDF password storage via ASP.NET Data Protection, search query and navigation fixes, frontend performance optimizations with request cancellation and deferred loading, and comprehensive automated test suites.

---

## What's New in v3.1.0

### 🛡️ Statement Import Reliability & Data Protection
- **Account-Scoped Duplicate Detection & Atomic Persistence**: Prevents duplicate imports per account while gracefully handling overlapping statements by preserving user notes, custom tags, assigned categories, and original upload ownership.
- **Interrupted Import Recovery**: Automatic detection and recovery for interrupted imports and temporary file cleanup.
- **Import Review Warnings**: Real-time warnings for statement balance discrepancies and unrecognized merchants with direct drill-down links to imported records.
- **Encrypted PDF Passwords**: Saved account statement PDF passwords are now encrypted at rest using ASP.NET Core Data Protection (`Uploads/.statement-keys`), with transparent migration of legacy plaintext passwords on startup.
- **Serialized Import Processing**: Concurrent manual uploads and automated watch-folder sweeps are queued and executed sequentially to eliminate database lock contention.

### 🔍 Search Navigation & Anomaly Drill-Down
- **Scoped Global Search**: Navigating to transactions via global search (`Ctrl+K`) or anomaly alert links properly initializes the account scope and active search filters, even when the Transactions page is already active.
- **Request Cancellation & Anti-Overlap**: Search autocomplete queries honor request cancellation tokens, and import error polling suppresses overlapping background requests.

### ⚡ Performance & Usability Improvements
- **Paginated Google Pay Activity**: Google Pay records and insights are paginated for instant rendering and reduced memory footprint.
- **Batched Account Summaries**: Multi-account status cards batch database queries for responsive dashboard load times.
- **Deferred Dialog & Page Loading**: Lazy-loaded settings sub-panels and modal dialogs reduce initial bundle evaluation overhead.
- **Settings Layout Polish**: Streamlined Google Pay profile configuration and account import action buttons.

### 🗄️ Database Migrations (v8)
- Added `Migration 8` introducing recoverable import tracking metadata, account file-hash uniqueness, and encrypted storage columns for statement credentials.

---

## Artifact Checksums

| Artifact | File | Size | SHA-256 Checksum |
|---|---|---|---|
| **Windows Installer** | `BankStatementAnalytics-Setup-3.1.0.exe` | 66.7 MB | `574f1039696a9e5852cd8cf535e347307c2722f391ca8e1e11ae0050f53aa24e` |
| **Portable ZIP** | `BankStatementAnalytics-Portable-3.1.0.zip` | 101.3 MB | `8cd00c50737d0957a4bcfe322efaaaf47cc8e2d824cb6e208c2ae2bc12442582` |

---

## Installation & Upgrade

- **Existing Users (Installed Service)**: Run `BankStatementAnalytics-Setup-3.1.0.exe`. The installer will stop the existing background service, update the application files, execute migration 8, and restart the service. Your existing database (`Data/`), statements (`Uploads/`), and configuration are completely preserved.
- **Portable Users**: Extract `BankStatementAnalytics-Portable-3.1.0.zip` to a folder of your choice and copy over your `Data/` and `Uploads/` directories from your previous installation. Keep `Uploads/.statement-keys` intact to retain encrypted PDF passwords.
