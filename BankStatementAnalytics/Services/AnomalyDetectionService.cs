using System;
using System.Collections.Generic;
using System.Linq;
using NHibernate.Linq;
using Common.Framework.Data;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Services
{
    public class AnomalyDetectionService
    {
        public List<AnomalyAlert> DetectAnomalies(long userId, int lookbackDays = 90)
        {
            using var session = DbHelper.GetSession();

            var accountIds = AccountAccess.OwnedIds(session, userId);
            if (accountIds.Count == 0)
                return new List<AnomalyAlert>();

            var today = DateTime.Today;
            var since = today.AddDays(-lookbackDays);

            var debits = session.Query<BankTransaction>()
                .ExcludeOwnMoneyMoves()
                .Where(t => accountIds.Contains(t.AccountId) && t.Debit > 0 && t.TransactionDate >= since)
                .Select(t => new
                {
                    t.AccountId,
                    t.BankReference,
                    t.TransactionDate,
                    t.Description,
                    t.Debit,
                    MerchantName = t.CounterParty != null ? t.CounterParty.Name : null,
                    Category = t.CategoryOverride ?? (t.CounterParty != null ? t.CounterParty.Category : null)
                })
                .ToList();

            if (debits.Count < 5)
                return new List<AnomalyAlert>();

            var alerts = new List<AnomalyAlert>();

            // 1. Large single debit anomalies (> 3x median debit and >= 10,000)
            var sortedAmounts = debits.Select(d => d.Debit).OrderBy(a => a).ToList();
            var median = sortedAmounts[sortedAmounts.Count / 2];
            var highThreshold = Math.Max(median * 3.0m, 10000m);

            var recent30Days = today.AddDays(-30);
            var largeDebits = debits
                .Where(t => t.TransactionDate >= recent30Days && t.Debit >= highThreshold)
                .OrderByDescending(t => t.Debit)
                .Take(5);

            foreach (var t in largeDebits)
            {
                var merchant = t.MerchantName ?? t.Description;
                var ratio = median > 0 ? Math.Round(t.Debit / median, 1) : 1;
                alerts.Add(new AnomalyAlert
                {
                    Id = $"large_{t.BankReference}",
                    Type = "LargeSpend",
                    Severity = t.Debit >= highThreshold * 1.5m ? "critical" : "warning",
                    Title = "Unusually Large Spend",
                    Description = $"₹{t.Debit:N0} at {merchant} is {ratio}× higher than your median spend of ₹{median:N0}.",
                    Amount = t.Debit,
                    Date = t.TransactionDate,
                    Merchant = merchant,
                    Category = t.Category,
                    TransactionRef = t.BankReference
                });
            }

            // 2. Merchant spike anomalies: recent 30-day spend > 2.5x previous 60-day monthly avg
            var prior60DaysStart = today.AddDays(-90);
            var prior60DaysEnd = today.AddDays(-30);

            var merchantGroups = debits
                .Where(t => !string.IsNullOrWhiteSpace(t.MerchantName))
                .GroupBy(t => t.MerchantName!.Trim());

            foreach (var g in merchantGroups)
            {
                var recentSpend = g.Where(t => t.TransactionDate >= recent30Days).Sum(t => t.Debit);
                var priorSpend = g.Where(t => t.TransactionDate >= prior60DaysStart && t.TransactionDate < prior60DaysEnd).Sum(t => t.Debit);
                var priorMonthlyAvg = priorSpend / 2m;

                if (recentSpend >= 5000 && (priorMonthlyAvg == 0 ? recentSpend >= 10000 : recentSpend >= priorMonthlyAvg * 2.5m))
                {
                    alerts.Add(new AnomalyAlert
                    {
                        Id = $"spike_{g.Key}",
                        Type = "MerchantSpike",
                        Severity = "warning",
                        Title = $"Spend Spike: {g.Key}",
                        Description = $"You spent ₹{recentSpend:N0} at {g.Key} this month, significantly higher than your prior baseline.",
                        Amount = recentSpend,
                        Date = g.Max(t => t.TransactionDate),
                        Merchant = g.Key,
                        Category = g.First().Category,
                        TransactionRef = g.First().BankReference
                    });
                }
            }

            return alerts.OrderByDescending(a => a.Date).Take(10).ToList();
        }
    }

    public class AnomalyAlert
    {
        public string Id { get; set; } = string.Empty;
        public string Type { get; set; } = string.Empty;
        public string Severity { get; set; } = "warning";
        public string Title { get; set; } = string.Empty;
        public string Description { get; set; } = string.Empty;
        public decimal Amount { get; set; }
        public DateTime Date { get; set; }
        public string? Merchant { get; set; }
        public string? Category { get; set; }
        public string? TransactionRef { get; set; }
    }
}
