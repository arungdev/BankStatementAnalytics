using System;
using System.Collections.Generic;
using System.Linq;
using NHibernate.Linq;
using Common.Framework.Data;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Services
{
    public class SubscriptionService
    {
        private readonly RecurringBillService _billService;

        public SubscriptionService(RecurringBillService billService)
        {
            _billService = billService;
        }

        public SubscriptionSummary GetSubscriptions(long userId)
        {
            using var session = DbHelper.GetSession();

            var accountIds = AccountAccess.OwnedIds(session, userId);
            if (accountIds.Count == 0)
                return new SubscriptionSummary();

            // Get confirmed bills
            var bills = _billService.GetConfirmedBillViews(userId);

            // Keywords that strongly imply subscriptions
            var subKeywords = new[] { "NETFLIX", "SPOTIFY", "PRIME", "HOTSTAR", "YOUTUBE", "APPLE", "GOOGLE", "CLOUDFLARE", "OPENAI", "GITHUB", "SUBSCRIPTION", "MEMBERSHIP", "DISNEY", "ZEE5", "SONYLIV", "AMAZON PRIME", "SWIGGY ONE", "ZOMATO GOLD" };

            var subBills = bills.Where(b =>
            {
                var upperName = (b.Name ?? "").ToUpperInvariant();
                var upperKey = (b.MatchKey ?? "").ToUpperInvariant();
                var isMatch = subKeywords.Any(k => upperName.Contains(k) || upperKey.Contains(k));
                var isMonthlySmall = (b.Cadence == "Monthly" || b.Cadence == null) && b.ExpectedAmount < 6000 && b.ExpectedAmount > 0;
                return isMatch || isMonthlySmall;
            }).ToList();

            // Fetch recent debits for these counterparties / keys to check price changes
            var lookback = DateTime.Today.AddMonths(-6);
            var history = session.Query<BankTransaction>()
                .ExcludeOwnMoneyMoves()
                .Where(t => accountIds.Contains(t.AccountId) && t.Debit > 0 && t.TransactionDate >= lookback)
                .Select(t => new
                {
                    t.BankReference,
                    t.TransactionDate,
                    t.Debit,
                    MerchantName = t.CounterParty != null ? t.CounterParty.Name : null,
                    t.Description
                })
                .OrderByDescending(t => t.TransactionDate)
                .ToList();

            var items = new List<SubscriptionItem>();

            foreach (var b in subBills)
            {
                // Find transactions matching this bill
                var txns = history.Where(h =>
                {
                    var mName = h.MerchantName ?? h.Description ?? "";
                    return mName.IndexOf(b.Name, StringComparison.OrdinalIgnoreCase) >= 0 ||
                           (!string.IsNullOrEmpty(b.MatchKey) && mName.IndexOf(b.MatchKey, StringComparison.OrdinalIgnoreCase) >= 0);
                }).OrderByDescending(x => x.TransactionDate).ToList();

                PriceChangeInfo? priceChange = null;
                if (txns.Count >= 2)
                {
                    var latest = txns[0].Debit;
                    var previous = txns[1].Debit;
                    if (Math.Abs(latest - previous) > 5) // more than 5 rupees difference
                    {
                        priceChange = new PriceChangeInfo
                        {
                            PreviousAmount = previous,
                            CurrentAmount = latest,
                            EffectiveDate = txns[0].TransactionDate.ToString("yyyy-MM-dd"),
                            IsIncrease = latest > previous
                        };
                    }
                }

                var normalizedMonthly = b.Cadence switch
                {
                    "Yearly" => b.ExpectedAmount / 12,
                    "Quarterly" => b.ExpectedAmount / 3,
                    "Weekly" => b.ExpectedAmount * 52 / 12,
                    _ => b.ExpectedAmount
                };

                items.Add(new SubscriptionItem
                {
                    Id = b.Id,
                    Name = b.Name,
                    Amount = b.ExpectedAmount,
                    Cadence = b.Cadence ?? "Monthly",
                    NormalizedMonthlyAmount = Math.Round(normalizedMonthly, 2),
                    DueDayOfMonth = b.DueDayOfMonth,
                    NextDueDate = b.NextDueDate.ToString("yyyy-MM-dd"),
                    DaysUntilDue = b.DaysUntilDue,
                    PriceChange = priceChange,
                    LastChargedDate = txns.FirstOrDefault()?.TransactionDate.ToString("yyyy-MM-dd")
                });
            }

            var totalMonthly = items.Sum(i => i.NormalizedMonthlyAmount);

            return new SubscriptionSummary
            {
                TotalMonthly = Math.Round(totalMonthly, 2),
                TotalAnnual = Math.Round(totalMonthly * 12, 2),
                Count = items.Count,
                Subscriptions = items.OrderBy(x => x.DaysUntilDue).ToList()
            };
        }
    }

    public class SubscriptionSummary
    {
        public decimal TotalMonthly { get; set; }
        public decimal TotalAnnual { get; set; }
        public int Count { get; set; }
        public List<SubscriptionItem> Subscriptions { get; set; } = new List<SubscriptionItem>();
    }

    public class SubscriptionItem
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public decimal Amount { get; set; }
        public string Cadence { get; set; } = "Monthly";
        public decimal NormalizedMonthlyAmount { get; set; }
        public int DueDayOfMonth { get; set; }
        public string NextDueDate { get; set; } = string.Empty;
        public int DaysUntilDue { get; set; }
        public PriceChangeInfo? PriceChange { get; set; }
        public string? LastChargedDate { get; set; }
    }

    public class PriceChangeInfo
    {
        public decimal PreviousAmount { get; set; }
        public decimal CurrentAmount { get; set; }
        public string EffectiveDate { get; set; } = string.Empty;
        public bool IsIncrease { get; set; }
    }
}
