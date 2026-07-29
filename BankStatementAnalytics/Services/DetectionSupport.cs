using System;
using System.Collections.Generic;
using System.Linq;

namespace BankStatementAnalytics.Services
{
    /// <summary>
    /// Narrow, read-only row shape the recurring-bill and deposit detectors project their queries
    /// into, so history scans don't hydrate whole <see cref="Models.BankTransaction"/> entities
    /// (with change tracking and every column) just to read a handful of fields.
    /// </summary>
    internal sealed class DetectionTxn
    {
        public DateTime TransactionDate { get; set; }
        public decimal Debit { get; set; }
        public decimal Credit { get; set; }
        public string? Mode { get; set; }
        public string? Narration { get; set; }
        public string? Description { get; set; }
        public string BankReference { get; set; } = string.Empty;
        public int? CounterPartyId { get; set; }
        public string? CounterPartyName { get; set; }
        public string? CounterPartyFriendlyName { get; set; }

        /// <summary>Merchant display name: friendly name if set, else the raw merchant name.</summary>
        public string? MerchantDisplay =>
            CounterPartyId == null
                ? null
                : !string.IsNullOrWhiteSpace(CounterPartyFriendlyName) ? CounterPartyFriendlyName : CounterPartyName;
    }

    internal static class DetectionQuery
    {
        /// <summary>
        /// Filters out the user's own money moving between their accounts: parser-marked
        /// TRANSFER rows (credit-card bill payments) and detected inter-account transfer
        /// pairs (<see cref="Models.BankTransaction.TransferGroupId"/>). Analytics apply
        /// this so transfers inflate neither income nor spend.
        /// </summary>
        public static IQueryable<Models.BankTransaction> ExcludeOwnMoneyMoves(this IQueryable<Models.BankTransaction> query) =>
            query.Where(t => (t.Mode == null || t.Mode != "TRANSFER") && t.TransferGroupId == null);

        /// <summary>Projects a transaction query into the narrow <see cref="DetectionTxn"/> shape.</summary>
        public static IQueryable<DetectionTxn> ProjectDetection(this IQueryable<Models.BankTransaction> query) =>
            query.Select(t => new DetectionTxn
            {
                TransactionDate = t.TransactionDate,
                Debit = t.Debit,
                Credit = t.Credit,
                Mode = t.Mode,
                Narration = t.Narration,
                Description = t.Description,
                BankReference = t.BankReference,
                CounterPartyId = t.CounterParty != null ? (int?)t.CounterParty.Id : null,
                CounterPartyName = t.CounterParty != null ? t.CounterParty.Name : null,
                CounterPartyFriendlyName = t.CounterParty != null ? t.CounterParty.FriendlyName : null
            });
    }

    /// <summary>
    /// Small numeric/text helpers shared by the detection services (previously duplicated in each).
    /// </summary>
    internal static class DetectionMath
    {
        public static decimal Median(IReadOnlyList<decimal> values)
        {
            var sorted = values.OrderBy(v => v).ToList();
            int n = sorted.Count;
            if (n == 0) return 0m;
            return n % 2 == 1 ? sorted[n / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2m;
        }

        public static int MedianInt(IReadOnlyList<int> values)
        {
            var sorted = values.OrderBy(v => v).ToList();
            int n = sorted.Count;
            if (n == 0) return 1;
            return n % 2 == 1 ? sorted[n / 2] : (int)Math.Round((sorted[n / 2 - 1] + sorted[n / 2]) / 2.0);
        }
    }
}
