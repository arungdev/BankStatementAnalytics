# Google Pay Takeout implementation

Implemented against the actual `takeout-20261003T045601Z-1-001.zip`, not assumed export fields. Detailed source findings are in `GPAY_TAKEOUT_ANALYSIS.md`.

## Delivered

- A GPay Activity workspace with Payment History, Digital Orders, Cashback, and Vouchers. Records use compact sortable tables, shared pagination, and right-hand details. The full Bill Splits page adjusts beside the resizable panel.
- Source-preserving, repeat-safe imports and archive-hash validation between preview and import. Existing financial interpretations are presented as reviewable repairs instead of silently overwritten.
- Backend support for reviewed identity, personal-share, and settlement corrections, with stale-data checks, audit history, and guarded undo. The dedicated repair, identity, allocation, and review-history tabs were removed from the UI at the user's request; the APIs remain available.
- Closed expenses remain historical; unpaid participants are not automatically treated as settled. Source payment states are separate from verified bank evidence.
- Collections and personal obligations show the correct direction, outstanding amounts, observed participants, and age.
- Payment history, digital orders, cashback, and vouchers retain the exported details and source limitations.
- Bank candidates use direction, amount, date, account hints, and name evidence. Matches require confirmation; ambiguous amount-only matches never silently settle expenses.
- Explicit participant repayments support incoming credits and outgoing personal repayment debits. Linked transactions open in the right-hand transaction panel.
- Partial payments and a bank transaction shared between participants have a separate allocation ledger, capacity checks, ownership checks, removal, and audit history.
- Imported groups and participants cannot be manually deleted or marked paid through custom-only actions. Custom split actions remain available.
- Responsive tables, clear filters, readable statuses, and source/evidence distinctions reuse the application's styling. Transactions with explicit GPay import annotations show a GPay badge and payment context in their details panel.

## Activate and use

Restart the backend to load the new services and schema migration 6. Configure the GPay importer in Settings and view imported records under Bill Splits → GPay Activity. The dedicated import button and import-preview/identity panels were removed from Bill Splits at the user's request; the configured importer and import/preview APIs remain available.

Review old duplicate or inconsistent bank links separately before changing them. Legacy links must be unlinked before replacing them with allocation-ledger entries. The backend repair APIs provide guarded undo when the repaired expense has not subsequently changed.

No live historical repairs or bank matches were applied during implementation.

## Evidence limits

The export does not prove current group membership, due dates, partial paid amounts, or bank references for every repayment. Participant counts represent observed source participants. Closed expenses can retain unpaid states. Manually marked payments are not bank verification. Google Play balance orders are not automatically bank debits; voucher expiry does not prove redemption. Changed structural expense allocations require manual investigation rather than automatic rewriting.

## Verification

- Backend build: passed, zero warnings/errors.
- Frontend production build: passed; existing bundle-size warning remains.
- 33 isolated PostgreSQL integration checks: passed. Coverage includes complete archive parsing, all 276 expenses and 1,213 participant records, 3,095 activity records, CSV edge cases, migration, hash guards, missing-expense recovery, repeat imports, preservation of existing links, repair/undo, owner isolation, closed/unpaid history, partial and combined allocations, capacity limits, incoming/outgoing direction, unlink restoration, and imported-action guards.
- Browser checks with synthetic data: import preview, repair confirmation, bank candidate review, allocation entry, and 390px/768px responsive layouts passed. Wide tables scroll inside their containers without horizontal page overflow.
- Final UI checks: row details, keyboard activation, Escape/focus restoration, full-page resizing with the RHS, drag resizing, close restoration, and the full-width mobile drawer passed with synthetic records. Component lint and frontend builds passed after the final layout changes.

Integration tests used disposable database clones. Browser fixture checks did not confirm real bank transactions. These checks do not constitute a complete live-app end-to-end test of every pre-existing screen.
