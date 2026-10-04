# Bank Statement Analytics - Release Notes v3.0.0

**Release Date:** October 4, 2026  
**Version:** 3.0.0  

---

## Highlights

Bank Statement Analytics v3.0.0 represents a landmark release featuring **Bill Splits & Group Expense Sharing**, multi-profile **Google Pay (GPay) Takeout Activity Integration** with intelligent automatic bank statement matching, an end-to-end **Mobile & Desktop Responsive UI Redesign**, a brand-new **Tag Management System**, and **Local Network (LAN) Access Controls** with an **In-App Update Engine**.

With v3.0.0, personal and shared finance converge seamlessly: track group balances, link payments across bank statements and UPI activities, navigate effortlessly on any screen size, and keep your software updated securely.

---

## What's New in v3.0.0

### 👥 Bill Splits & Shared Expense Groups
- **Comprehensive Split Groups Hub**: Dedicated **Splits** page for tracking shared expenses across roommates, group trips, and recurring household bills.
- **Group & Member Tracking**: Support for named bill groups, custom participant lists, individual VPAs/UPI IDs, and assigned vs. settled amounts.
- **Transaction Splitting**: Split any single transaction across multiple categories or participants directly from the transaction drawer or dedicated modal.
- **Repayment Tracking in Analytics**: Split repayments are separated into personal shares and participant reimbursements, preventing double-counting in Overview, Trends, Net Cash Flow, and Reports.

### 📱 Google Pay (GPay) Activity Import & Automatic Bank Matching
- **Multi-Profile GPay Takeout Support**: Import Google Pay activity archives (`.zip` / `.json` exports) with complete isolation across multiple household or personal profiles.
- **High-Precision Bank Matching Engine**:
  - Deterministic multi-factor linking correlating transaction amounts, payment direction, bank account suffixes, and date / value-date evidence.
  - Value-date reconciliation for midnight and next-day bank value postings.
  - Bank payee name truncation handling and learned alias memory for shortened statement descriptions.
  - Competition detection and disambiguation warnings for same-day, same-amount transactions.
- **Evidence Inspection**: View source snapshots, settlement allocations, and verification statuses directly within transaction details.

### 🏷️ Tag Management & Custom TagPicker
- **Full Tag Lifecycle Management**: Create, edit, color-code, and delete custom tags from the new **Tags** management tab in Settings.
- **Instant TagPicker Popover**: Replaced native browser datalists with an interactive popover featuring search, recently used tags, and inline tag creation.
- **Split-Aware Tag Filtering**: Filter statement transactions by tags and split categories across all analytical views.

### 📱 Complete Responsive & Mobile UI Overhaul
- **Off-Canvas Slide-in Drawer Navigation**: Modern overlay drawer on tablet and mobile screens (<= 1024px) with backdrop dismissal and auto-close.
- **Adaptive Header & Breadcrumbs**: Mobile-friendly `PageHeader` with hamburger menu toggle, compact action buttons, and direct Settings gear access.
- **Single-Month Responsive Date Range Picker**: Adaptive calendar modal collapsing cleanly on mobile viewports (<= 640px) with horizontally scrollable preset chips.
- **2x2 Compact Stat Cards Grid**: Refactored KPI summaries across Overview, Trends, Insights, and Reports into high-density 2x2 grids on small screens.
- **Touch-Friendly Data Tables**: Horizontal scrolling wrappers (`.table-responsive`), clamped card row views for mobile transactions, and responsive action strips.

### ⚙️ Categorized Settings Hub & Navigation
- **Four Dedicated Setting Categories**:
  - 💳 **Finance & Data**: Accounts, Categorization Rules, Tags, Bank Data, Import / Export.
  - 🎨 **Preferences**: Appearance, Currency & Formatting, Display Options.
  - 🛡️ **System & Security**: Security & Passwords, Local Network Access, Software Updates, Service Diagnostics.
  - ℹ️ **Help & Support**: About, Documentation, Logs, Reset.
- **Settings Search & Quick Jump**: Search across all settings panels or use `Ctrl+K` to jump directly to any configuration section.

### 🌐 Local Network (LAN) Access Controls
- **Private Network Sharing**: Safely allow phones, tablets, or other local devices on your home/office network (RFC 1918) to access Bank Statement Analytics.
- **Network Settings UI**: Real-time LAN toggle, host IP address discovery, and one-click copyable device URLs.
- **RoleGate & CORS Protection**: Middleware protection restricting or granting access per device origin.

### 🔄 In-App Update Engine
- **Automated Update Checking**: Check for new releases directly from the **Updates** tab in Settings.
- **Detached Upgrade Runner**: Download signed installers and trigger service upgrades seamlessly from the web interface.

### 🗄️ Database Migrations (Versions 4, 5, 6, 7)
- **Migration 4**: Introduced `split_groups` and `split_group_members` tables.
- **Migration 5**: Added persistent `bill_groups` and `bill_group_members` schema.
- **Migration 6**: Added Google Pay source evidence (`gpay_evidence_records`), settlement allocations (`gpay_settlement_allocations`), and source state indices.
- **Migration 7**: Added multi-profile support columns (`gpayprofileid`, `gpayownername`) on split and bill groups.

---

## Artifact Checksums

| Artifact | File | Size | SHA-256 Checksum |
|---|---|---|---|
| **Windows Installer** | `BankStatementAnalytics-Setup-3.0.0.exe` | 66.7 MB | `9722a1bfdd9f7044d620f6652c3b3efc84fc7d55ed0c415bf96039386c5c1141` |
| **Portable ZIP** | `BankStatementAnalytics-Portable-3.0.0.zip` | 101.3 MB | `77707a857957afc90f488b73141e8de0ff86089d020681034ee58f4ac2fd81fc` |

---

## Installation & Upgrade

- **Existing Users (Installed Service)**: Run `BankStatementAnalytics-Setup-3.0.0.exe`. The installer will automatically stop the running service, update application files, execute database migrations 4 through 7, and restart the service. Your existing database, account configurations, and uploaded statements in the `Data\` folder are completely preserved.
- **Portable Users**: Extract `BankStatementAnalytics-Portable-3.0.0.zip` to your desired folder and launch `BankStatementAnalytics.exe`. Existing database folders can be migrated simply by copying the `Data\` directory.
