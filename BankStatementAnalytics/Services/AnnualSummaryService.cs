using System;
using System.Collections.Generic;
using System.Linq;
using NHibernate.Linq;
using Common.Framework.Data;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Services
{
    public class AnnualSummaryService
    {
        public AnnualSummaryReport GenerateAnnualSummary(long userId, int year, int? accountId = null, string accountIds = null)
        {
            using var session = DbHelper.GetSession();

            var ownedIds = AccountAccess.OwnedIdSet(session, userId);
            var (status, ids) = AccountAccess.ResolveScope(ownedIds, accountIds, accountId ?? 0);
            if (status == AccountAccess.ScopeStatus.NotFound || ids.Count == 0)
            {
                return new AnnualSummaryReport { Year = year };
            }

            var startOfYear = new DateTime(year, 1, 1);
            var endOfYear = startOfYear.AddYears(1);

            var query = session.Query<BankTransaction>()
                .ExcludeOwnMoneyMoves()
                .Where(t => ids.Contains(t.AccountId));

            query = query.Where(t => (t.EffectiveDate ?? t.TransactionDate) >= startOfYear && (t.EffectiveDate ?? t.TransactionDate) < endOfYear);

            var rows = query.Select(t => new
            {
                Date = t.EffectiveDate ?? t.TransactionDate,
                t.Debit,
                t.Credit,
                t.Description,
                Merchant = t.CounterParty != null ? t.CounterParty.Name : null,
                Category = t.CategoryOverride ?? (t.CounterParty != null ? t.CounterParty.Category : "Uncategorized"),
            }).ToList();

            if (rows.Count == 0)
                return new AnnualSummaryReport { Year = year };

            var totalIncome = rows.Sum(r => r.Credit);
            var totalSpend = rows.Sum(r => r.Debit);
            var netSavings = totalIncome - totalSpend;
            var savingsRate = totalIncome > 0 ? Math.Round((double)(netSavings / totalIncome) * 100, 1) : 0;

            // Monthly breakdown
            var monthNames = new[] { "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" };
            var monthly = new List<MonthlySummaryItem>();

            for (int m = 1; m <= 12; m++)
            {
                var monthRows = rows.Where(r => r.Date.Month == m).ToList();
                var mSpend = monthRows.Sum(r => r.Debit);
                var mIncome = monthRows.Sum(r => r.Credit);
                monthly.Add(new MonthlySummaryItem
                {
                    Month = m,
                    MonthName = monthNames[m - 1],
                    Income = mIncome,
                    Spend = mSpend,
                    Net = mIncome - mSpend,
                    TransactionCount = monthRows.Count
                });
            }

            var activeMonths = monthly.Where(m => m.Spend > 0).ToList();
            var busiestMonth = activeMonths.OrderByDescending(m => m.Spend).FirstOrDefault()?.MonthName;
            var quietestMonth = activeMonths.OrderBy(m => m.Spend).FirstOrDefault()?.MonthName;

            // Top categories
            var topCategories = rows
                .Where(r => r.Debit > 0)
                .GroupBy(r => r.Category)
                .Select(g => new CategoryRankItem
                {
                    Category = g.Key,
                    TotalSpend = g.Sum(x => x.Debit),
                    TransactionCount = g.Count(),
                    Percentage = totalSpend > 0 ? Math.Round((double)(g.Sum(x => x.Debit) / totalSpend) * 100, 1) : 0
                })
                .OrderByDescending(c => c.TotalSpend)
                .Take(6)
                .ToList();

            // Top merchants
            var topMerchants = rows
                .Where(r => r.Debit > 0 && !string.IsNullOrWhiteSpace(r.Merchant))
                .GroupBy(r => r.Merchant!.Trim())
                .Select(g => new MerchantRankItem
                {
                    Merchant = g.Key,
                    TotalSpend = g.Sum(x => x.Debit),
                    TransactionCount = g.Count()
                })
                .OrderByDescending(m => m.TotalSpend)
                .Take(10)
                .ToList();

            // Most frequent merchant
            var mostFrequent = rows
                .Where(r => r.Debit > 0 && !string.IsNullOrWhiteSpace(r.Merchant))
                .GroupBy(r => r.Merchant!.Trim())
                .OrderByDescending(g => g.Count())
                .Select(g => new MerchantRankItem
                {
                    Merchant = g.Key,
                    TotalSpend = g.Sum(x => x.Debit),
                    TransactionCount = g.Count()
                })
                .FirstOrDefault();

            // Biggest single transaction
            var biggestSpend = rows
                .Where(r => r.Debit > 0)
                .OrderByDescending(r => r.Debit)
                .Select(r => new BiggestSpendItem
                {
                    Amount = r.Debit,
                    Merchant = r.Merchant ?? r.Description,
                    Date = r.Date.ToString("yyyy-MM-dd"),
                    Category = r.Category
                })
                .FirstOrDefault();

            return new AnnualSummaryReport
            {
                Year = year,
                TotalIncome = totalIncome,
                TotalSpend = totalSpend,
                NetSavings = netSavings,
                SavingsRate = savingsRate,
                TotalTransactions = rows.Count,
                BusiestMonth = busiestMonth,
                QuietestMonth = quietestMonth,
                TopCategories = topCategories,
                TopMerchants = topMerchants,
                MostFrequentMerchant = mostFrequent,
                BiggestSpend = biggestSpend,
                MonthlyBreakdown = monthly
            };
        }
    }

    public class AnnualSummaryReport
    {
        public int Year { get; set; }
        public decimal TotalIncome { get; set; }
        public decimal TotalSpend { get; set; }
        public decimal NetSavings { get; set; }
        public double SavingsRate { get; set; }
        public int TotalTransactions { get; set; }
        public string? BusiestMonth { get; set; }
        public string? QuietestMonth { get; set; }
        public List<CategoryRankItem> TopCategories { get; set; } = new();
        public List<MerchantRankItem> TopMerchants { get; set; } = new();
        public MerchantRankItem? MostFrequentMerchant { get; set; }
        public BiggestSpendItem? BiggestSpend { get; set; }
        public List<MonthlySummaryItem> MonthlyBreakdown { get; set; } = new();
    }

    public class CategoryRankItem
    {
        public string Category { get; set; } = string.Empty;
        public decimal TotalSpend { get; set; }
        public int TransactionCount { get; set; }
        public double Percentage { get; set; }
    }

    public class MerchantRankItem
    {
        public string Merchant { get; set; } = string.Empty;
        public decimal TotalSpend { get; set; }
        public int TransactionCount { get; set; }
    }

    public class BiggestSpendItem
    {
        public decimal Amount { get; set; }
        public string Merchant { get; set; } = string.Empty;
        public string Date { get; set; } = string.Empty;
        public string Category { get; set; } = string.Empty;
    }

    public class MonthlySummaryItem
    {
        public int Month { get; set; }
        public string MonthName { get; set; } = string.Empty;
        public decimal Income { get; set; }
        public decimal Spend { get; set; }
        public decimal Net { get; set; }
        public int TransactionCount { get; set; }
    }
}
