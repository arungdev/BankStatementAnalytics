# GPay matching regression checks

Run `dotnet run --project Tests/GPayMatching/GPayMatching.csproj` from the repository root.
The executable uses synthetic records and does not connect to a database or change stored data.

It checks exact-date/amount/direction matching, account suffixes, whole-token payee matching,
failed/pending payments, duplicate candidates and source versions, existing confirmations,
rejections, transfer exclusion, and separation of profile accounts and personal identities.
It also covers actual IOB name truncation, punctuation/PDF spacing, conflicting surnames,
short prefixes, missing account hints, different-bank exclusions, and competing truncated names.
Confirmed payee aliases are tested for exact names, explicit confirmation requirements, account,
profile, direction, bank and mode isolation, competing payments, and existing source identifiers.
Explicit bank value dates are checked for one-day limits, UPI-only eligibility, competing
transaction/value dates, reciprocal uniqueness, and preservation of the other matching safeguards.
Ambiguous matches expose factual bank candidates and competing source counts without confirming
any link. Coverage includes repeated unnamed receipts, duplicate source versions, stable ordering,
and exclusion of unowned, already confirmed, wrong-account and conflicting-payee bank candidates.

If the application is running and locks its build output, use a separate output directory:
`dotnet run --project Tests/GPayMatching/GPayMatching.csproj -p:BaseOutputPath=D:/BankStatementAnalytics/.analysis-gpay/regression-build/`.
