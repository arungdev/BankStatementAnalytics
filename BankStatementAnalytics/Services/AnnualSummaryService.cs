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
        public AnnualSummaryReport GenerateAnnualSummary(long userId, int year, int? accountId = null, string? accountIds = null)
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
                t.AccountId,
                t.BankReference,
                t.BankType,
                Date = t.EffectiveDate ?? t.TransactionDate,
                t.Debit,
                t.Credit,
                t.Description,
                Merchant = t.CounterParty != null ? t.CounterParty.Name : null,
                Category = t.CategoryOverride ?? (t.CounterParty != null ? t.CounterParty.Category : "Uncategorized"),
                t.SubCategoryOverride
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
            var highestMonth = activeMonths.OrderByDescending(m => m.Spend).FirstOrDefault();
            var lowestMonth = activeMonths.OrderBy(m => m.Spend).FirstOrDefault();
            var avgMonthlySpend = activeMonths.Count > 0
                ? Math.Round(totalSpend / activeMonths.Count, 2)
                : (totalSpend > 0 ? Math.Round(totalSpend / 12, 2) : 0);

            // Top categories
            var splitsLookup = TransactionSplitHelper.GetSplitsLookupAsync(session, ids).GetAwaiter().GetResult();

            var expandedDebits = rows
                .Where(r => r.Debit > 0)
                .SelectMany(r => TransactionSplitHelper.ExpandSpend(
                    r.AccountId,
                    r.BankReference,
                    r.BankType,
                    r.Debit,
                    r.Category ?? "Uncategorized",
                    r.SubCategoryOverride,
                    splitsLookup))
                .ToList();

            var topCategories = expandedDebits
                .GroupBy(r => string.IsNullOrWhiteSpace(r.Category) ? "Uncategorized" : r.Category.Trim())
                .Select(g => new CategoryRankItem
                {
                    Category = g.Key,
                    TotalSpend = g.Sum(x => x.Amount),
                    TransactionCount = g.Count(),
                    Percentage = totalSpend > 0 ? Math.Round((double)(g.Sum(x => x.Amount) / totalSpend) * 100, 1) : 0
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
                    TransactionCount = g.Count(),
                    Percentage = totalSpend > 0 ? Math.Round((double)(g.Sum(x => x.Debit) / totalSpend) * 100, 1) : 0
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
                    TransactionCount = g.Count(),
                    Percentage = totalSpend > 0 ? Math.Round((double)(g.Sum(x => x.Debit) / totalSpend) * 100, 1) : 0
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
                    Category = r.Category ?? "Uncategorized"
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
                HighestSpendMonthAmount = highestMonth?.Spend ?? 0,
                HighestSpendMonthName = highestMonth?.MonthName ?? "—",
                LowestSpendMonthAmount = lowestMonth?.Spend ?? 0,
                LowestSpendMonthName = lowestMonth?.MonthName ?? "—",
                AvgMonthlySpend = avgMonthlySpend,
                BusiestMonth = highestMonth?.MonthName,
                QuietestMonth = lowestMonth?.MonthName,
                TopCategories = topCategories,
                TopMerchants = topMerchants,
                MostFrequentMerchant = mostFrequent,
                BiggestSpend = biggestSpend,
                Monthly = monthly,
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
        public decimal HighestSpendMonthAmount { get; set; }
        public string HighestSpendMonthName { get; set; } = "—";
        public decimal LowestSpendMonthAmount { get; set; }
        public string LowestSpendMonthName { get; set; } = "—";
        public decimal AvgMonthlySpend { get; set; }
        public string? BusiestMonth { get; set; }
        public string? QuietestMonth { get; set; }
        public List<CategoryRankItem> TopCategories { get; set; } = new();
        public List<MerchantRankItem> TopMerchants { get; set; } = new();
        public MerchantRankItem? MostFrequentMerchant { get; set; }
        public BiggestSpendItem? BiggestSpend { get; set; }
        public List<MonthlySummaryItem> Monthly { get; set; } = new();
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
        public double Percentage { get; set; }
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
