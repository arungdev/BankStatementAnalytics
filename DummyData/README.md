# Dummy Data & Asset Generation Suite

This folder provides a complete synthetic data generator and automated screenshot capture pipeline for **BankStatementAnalytics**. It allows running, demonstrating, testing, and photographing the entire application without using any real personal financial records.

## Generated Synthetic Statement Files

| File | Bank / Provider | Format | Contents |
|---|---|---|---|
| `hdfc_savings_statement.txt` | HDFC Bank Savings | Fixed-width text | 4 months (Jul–Oct 2026) of salary credits, rent payments, groceries, food delivery, utilities, credit card bill payments, mutual fund SIPs, fixed deposits, and recurring deposits. |
| `hdfc_creditcard_statement.csv` | HDFC Millennia Credit Card | `~|~` Delimited CSV | Billing cycles, credit limit (₹2,50,000), domestic tech purchases, dining, subscriptions, and international forex transactions (USD). |
| `iob_savings_statement.txt` | Indian Overseas Bank (IOB) | Fixed-width text | Inward self-transfers from HDFC, mutual fund SIP investments via Groww, interest credits, and local merchant payments. |
| `gpay_takeout_dummy.zip` | Google Pay Takeout | ZIP Archive | `Takeout/Google Pay/My Activity/My Activity.html` matching bank UPI references, `Group expenses.json` for bill splits, and `Cashback rewards.csv`. |

## Automation Scripts

| Script | Purpose |
|---|---|
| `generate_statements.mjs` | Generates the synthetic HDFC, IOB, and Credit Card statement export files. |
| `create_gpay_zip.mjs` | Packages the Google Pay Takeout activity and group expenses into `gpay_takeout_dummy.zip`. |
| `seed_database.mjs` | Connects to a running instance of the application (`http://127.0.0.1:5085`), registers an admin account, creates accounts, imports statements, and seeds Budgets, Recurring Bills, Savings Goals, Deposits, and Bill Split groups. |
| `capture_assets.mjs` | Launches headless Google Chrome at 2400x1500 resolution via Chrome DevTools Protocol (CDP), navigates every tab, and captures all 22 screenshots. Outputs 2400x1500 PNGs into `BankStatementAnalytics/screenshots/` and 2400x1500 WebP images into `arungdev.github.io/_build/screenshots/`. |

## How to Run

1. **Ensure the local application is running**:
   ```powershell
   $env:ASPNETCORE_URLS = "http://127.0.0.1:5085"
   & "D:\BankStatementAnalytics\Publish\BankStatementAnalytics.exe"
   ```

2. **Generate the dummy statements**:
   ```bash
   node generate_statements.mjs
   node create_gpay_zip.mjs
   ```

3. **Seed the database**:
   ```bash
   node seed_database.mjs
   ```

4. **Capture all 22 asset screenshots**:
   ```bash
   node capture_assets.mjs
   ```

5. **Rebuild the showcase site**:
   ```bash
   cd D:\arungdev.github.io\_build
   node build.js
   ```
