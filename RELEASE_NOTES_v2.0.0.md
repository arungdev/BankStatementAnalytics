# Bank Statement Analytics - Release Notes v2.0.0

**Release Date:** September 20, 2026  
**Version:** 2.0.0  

---

## Highlights

Bank Statement Analytics v2.0.0 introduces major enhancements for financial planning, discovery, foreign currency tracking, and performance. With a refreshed and refined user interface, automated database migrations, and advanced analytics tools, managing personal finances from statement exports is more intuitive and powerful than ever.

---

## What's New in v2.0.0

### 🔍 Global Search Modal
- Press `/` anywhere in the app to open the quick-search overlay.
- Instantly search across transactions, merchants, accounts, transaction notes, and categories.
- Jump directly to the relevant record or filtered view with a single keystroke.

### 🌐 Forex & International Transactions Tracking
- Automatic detection and tagging of multi-currency transactions and international card swipes.
- Transparent tracking of foreign exchange charges, estimated markup fees, and currency conversions.

### 📅 Annual Financial Summary & Net Worth Trajectory
- Comprehensive multi-year financial health overview.
- Net worth growth trajectory charts and annual cash-flow breakdown.
- Year-over-year category comparisons to understand long-term spending patterns.

### 📊 Daily Spending Heatmap
- Visual intensity calendar heatmap displaying spending spikes, heavy expenditure days, and quiet periods at a glance.
- Click into any day to drill down into the exact transactions that took place.

### 🎯 Advanced Financial Planning & Analytics
- **Burn Rate & Runway Calculator**: Predicts how long existing savings will last based on historical net outflow.
- **Emergency Fund Target**: Configurable safety buffer tracker with monthly progress metrics.
- **Retirement & Savings Growth Forecast**: Interactive projections modeling monthly compounding savings.

### ⚡ Instant Branded Launch Splash
- Immediate visual feedback on initial load with a branded splash animation, eliminating white flashes while services initialize.

### 📋 Enhanced Interactive Data Tables
- Column header dropdown menus in **Transactions** and **Merchants** pages.
- Sort ascending/descending and filter dynamically by merchant, category, date, or amount.
- Improved row selection styling and checkbox contrast in both light and dark themes.

### 💳 Credit Card Handling & Shared Limits
- Fixed calculations for shared credit limits across multiple cards to accurately reflect available credit and avoid negative balances.
- Proper masking of card and account numbers.
- Unsaved draft state preservation in the Settings card dialog.
- Corrected billing-month cycle boundary calculations and drill-down date ranges in Trends.

### 🗄️ Database Migrations Framework
- Automated database schema migrations powered by `Common.Framework.Migrations`.
- Versioned, idempotent schema updates that apply automatically on application startup without requiring manual intervention.

---

## Artifact Checksums

| Artifact | File | Size | SHA-256 Checksum |
|---|---|---|---|
| **Windows Installer** | `BankStatementAnalytics-Setup-2.0.0.exe` | 66.2 MB | `a5a404a1932938483887ebab629a1cd32cf01d920a14daf1fdf740fac408ed1d` |
| **Portable ZIP** | `BankStatementAnalytics-Portable-2.0.0.zip` | 100.7 MB | `c3c9b83bb7ea283126d47f331a84edfbbf5db4fcbf9f7168db45891d1e50dc3e` |

---

## Installation & Upgrade

- **Existing Users (Installed Service)**: Run `BankStatementAnalytics-Setup-2.0.0.exe`. The installer will automatically stop the running service, update the application files, run database migrations, and restart the service. Your existing statements and transaction data in the `Data\` folder are fully preserved.
- **Portable Users**: Extract `BankStatementAnalytics-Portable-2.0.0.zip` to a folder of your choice and launch `BankStatementAnalytics.exe`.
