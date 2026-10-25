# Bill Splits in other pages

- **Overview:** current To Collect and Owed by Me balances, with an outstanding-bill drawer and links to the existing expense details.
- **Reports:** total bill volume, personal share, To Collect and Owed by Me for bills dated in the selected month/year. These are current recorded balances for that cohort, not historical closing balances or repayments received during that period. This section is screen-only; existing bank-report PDF/print calculations are unchanged.
- **Transactions:** bill payment, participant repayment and personal repayment context for stored parent/member/allocation links. Links open the existing expense details. Only explicit settlement allocations are labelled as amounts allocated from a transaction.

The projections reuse `GPaySplitService.GetGroupsAsync` and its existing personal identity, recorded settlement and pending amount calculations. They do not update stored data, infer new matches, or adjust income, spending, budgets or forecasts.

All accounts includes all owned profiles and custom expenses, including imports without bank links. A selected account includes only expenses with a stored parent, member or allocation link to that account; the displayed balance belongs to the associated bill, not an independently allocated account balance. The transaction endpoint verifies account ownership and the full account/reference/bank/transaction-type identity of an existing bank row. All data reads are owner-scoped.

GPay Activity-to-bank matches are separate from expense-to-bank links. If no parent/member/allocation link exists, the transaction section stays hidden and a selected-account summary reports no bank-linked bills. Amount/date coincidences are insufficient to create these relationships. No schema migration is needed.

Verification:

```powershell
dotnet run --project Tests/SharedBills/SharedBills.csproj -p:UseAppHost=false -p:BaseOutputPath=D:/BankStatementAnalytics/.analysis-gpay/regression-build/
node Tests/SharedBills/report-range.mjs
```

The application and frontend must be rebuilt/restarted to load the new endpoints and components.
