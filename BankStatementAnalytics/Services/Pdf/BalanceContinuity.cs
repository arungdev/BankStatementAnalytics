using BankStatementAnalytics.Models;
using Common.Framework.Logging;

namespace BankStatementAnalytics.Services.Pdf
{
    /// <summary>
    /// Log-only sanity check for statements that carry a running balance:
    /// previous balance ± amount should equal the current row's balance.
    /// Discontinuities usually mean a misparsed row or column drift in the PDF
    /// extraction. Deliberately NOT a rejection gate (partial-period statements
    /// and page-boundary quirks can false-positive) — promote later if samples
    /// prove row ordering is reliable.
    /// </summary>
    public static class BalanceContinuity
    {
        public static void WarnOnGaps(IReadOnlyList<BankTransaction> transactions, string context)
        {
            if (transactions.Count < 2) return;

            // Statements can list rows oldest-first (HDFC) or newest-first (IOB);
            // the check needs chronological order. Reversing (rather than sorting)
            // preserves the statement's intra-day ordering.
            if (transactions[0].TransactionDate > transactions[^1].TransactionDate)
                transactions = transactions.Reverse().ToList();

            for (int i = 1; i < transactions.Count; i++)
            {
                var prev = transactions[i - 1];
                var cur = transactions[i];
                if (prev.Balance == 0 || cur.Balance == 0) continue;

                decimal expected = prev.Balance + cur.Credit - cur.Debit;
                if (Math.Abs(expected - cur.Balance) > 0.01m)
                    Log.Info($"{context}: balance continuity WARNING at " +
                             $"{cur.TransactionDate:dd/MM/yyyy} '{cur.Description}' — " +
                             $"expected {expected:0.00}, statement says {cur.Balance:0.00}");
            }
        }
    }
}
