using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using NHibernate.Linq;
using Common.Framework.Data;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Services
{
    /// <summary>
    /// Composes the monthly / yearly report payload served by <c>api/reports</c>.
    /// The income/spend/category/merchant sections are scoped to the requested accounts;
    /// budgets, bills, and deposits are user-level (all owned accounts), matching how their
    /// own pages behave.
    /// </summary>
    public class ReportService
    {
        private readonly RecurringBillService _bills;
        private readonly DepositService _deposits;

        public ReportService(RecurringBillService bills, DepositService deposits)
        {
            _bills = bills;
            _deposits = deposits;
        }

        public async Task<ReportView> BuildAsync(long userId, List<long> accountIds, bool yearly, int year, int month)
        {
            var start = yearly ? new DateTime(year, 1, 1) : new DateTime(year, month, 1);
            var end = yearly ? start.AddYears(1) : start.AddMonths(1);

            using var session = DbHelper.GetSession();

            // Narrow projection: only the fields the report sections read, not whole entities.
            var txns = await session.Query<BankTransaction>()
                .Where(t => accountIds.Contains(t.AccountId)
                         && t.TransactionDate >= start && t.TransactionDate < end)
                .Select(t => new ReportRow
                {
                    Credit = t.Credit,
                    Debit = t.Debit,
                    Month = t.TransactionDate.Month,
                    CategoryOverride = t.CategoryOverride,
                    MerchantName = t.CounterParty != null ? t.CounterParty.Name : null,
                    MerchantCategory = t.CounterParty != null ? t.CounterParty.Category : null
                })
                .ToListAsync();

            var report = new ReportView
            {
                Type = yearly ? "year" : "month",
                Label = yearly ? year.ToString() : start.ToString("MMMM yyyy"),
                StartDate = start,
                EndDate = end.AddDays(-1),
                Summary = new ReportSummary
                {
                    TotalIncome = txns.Sum(t => t.Credit),
                    TotalSpends = txns.Sum(t => t.Debit),
                    TransactionCount = txns.Count,
                },
            };
            report.Summary.Net = report.Summary.TotalIncome - report.Summary.TotalSpends;

            if (yearly)
            {
                report.MonthlySeries = Enumerable.Range(1, 12).Select(m => new ReportMonthBucket
                {
                    Month = m,
                    Label = new DateTime(year, m, 1).ToString("MMM"),
                    Income = txns.Where(t => t.Month == m).Sum(t => t.Credit),
                    Spend = txns.Where(t => t.Month == m).Sum(t => t.Debit),
                }).ToList();
            }

            var debits = txns.Where(t => t.Debit > 0).ToList();

            report.ByCategory = debits
                .GroupBy(t => t.CategoryOverride ?? t.MerchantCategory ?? "Uncategorized")
                .Select(g => new ReportGroupTotal { Name = g.Key, Total = g.Sum(t => t.Debit), Count = g.Count() })
                .OrderByDescending(x => x.Total)
                .ToList();

            report.TopMerchants = debits
                .Where(t => t.MerchantName != null)
                .GroupBy(t => t.MerchantName!)
                .Select(g => new ReportGroupTotal { Name = g.Key, Total = g.Sum(t => t.Debit), Count = g.Count() })
                .OrderByDescending(x => x.Total)
                .Take(10)
                .ToList();

            report.Budgets = await BuildBudgetsAsync(session, userId, yearly, year, start, end);
            report.Bills = _bills.GetPaymentsInPeriod(userId, start, end);
            report.Deposits = _deposits.GetContributionsInPeriod(userId, start, end);

            return report;
        }

        // Budget performance is user-level: spend counts every owned account regardless of the
        // report's account filter, the same way the Budgets page computes it.
        private static async Task<List<ReportBudgetRow>> BuildBudgetsAsync(
            NHibernate.ISession session, long userId, bool yearly, int year, DateTime start, DateTime end)
        {
            var budgets = session.Query<Budget>()
                .Where(b => b.OwnerUserId == userId)
                .ToList()
                .OrderBy(b => b.Category, StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (budgets.Count == 0)
                return new List<ReportBudgetRow>();

            // A yearly limit only covers months that have happened: 12 for past years,
            // months elapsed for the current year (a future year has no coverage).
            var monthsCovered = 1;
            if (yearly)
            {
                var now = DateTime.Now;
                monthsCovered = year < now.Year ? 12 : year == now.Year ? now.Month : 0;
            }

            var ownedIds = AccountAccess.OwnedIds(session, userId);

            var spentByCategory = new Dictionary<string, decimal>();
            if (ownedIds.Count > 0)
            {
                var debits = await session.Query<BankTransaction>()
                    .Where(t => ownedIds.Contains(t.AccountId) && t.Debit > 0
                             && t.TransactionDate >= start && t.TransactionDate < end)
                    .Select(t => new
                    {
                        t.Debit,
                        t.CategoryOverride,
                        MerchantCategory = t.CounterParty != null ? t.CounterParty.Category : null
                    })
                    .ToListAsync();

                spentByCategory = debits
                    .GroupBy(t => t.CategoryOverride ?? t.MerchantCategory ?? "Uncategorized")
                    .ToDictionary(g => g.Key, g => g.Sum(t => t.Debit));
            }

            return budgets.Select(b =>
            {
                spentByCategory.TryGetValue(b.Category, out var spent);
                var limit = b.MonthlyLimit * monthsCovered;
                return new ReportBudgetRow
                {
                    Category = b.Category,
                    Limit = limit,
                    Spent = spent,
                    Remaining = limit - spent,
                    Percent = limit > 0 ? Math.Round((double)(spent / limit) * 100, 1) : 0,
                    OverBudget = spent > limit,
                };
            }).ToList();
        }
    }

    // Narrow row shape read out of the DB for report aggregation (avoids hydrating entities).
    internal class ReportRow
    {
        public decimal Credit { get; set; }
        public decimal Debit { get; set; }
        public int Month { get; set; }
        public string? CategoryOverride { get; set; }
        public string? MerchantName { get; set; }
        public string? MerchantCategory { get; set; }
    }

    public class ReportView
    {
        public string Type { get; set; } = string.Empty;
        public string Label { get; set; } = string.Empty;
        public DateTime StartDate { get; set; }
        public DateTime EndDate { get; set; }
        public ReportSummary Summary { get; set; } = new();
        public List<ReportMonthBucket>? MonthlySeries { get; set; }
        public List<ReportGroupTotal> ByCategory { get; set; } = new();
        public List<ReportGroupTotal> TopMerchants { get; set; } = new();
        public List<ReportBudgetRow> Budgets { get; set; } = new();
        public List<BillPeriodView> Bills { get; set; } = new();
        public DepositPeriodSummary Deposits { get; set; } = new();
    }

    public class ReportSummary
    {
        public decimal TotalIncome { get; set; }
        public decimal TotalSpends { get; set; }
        public decimal Net { get; set; }
        public int TransactionCount { get; set; }
    }

    public class ReportMonthBucket
    {
        public int Month { get; set; }
        public string Label { get; set; } = string.Empty;
        public decimal Income { get; set; }
        public decimal Spend { get; set; }
    }

    public class ReportGroupTotal
    {
        public string Name { get; set; } = string.Empty;
        public decimal Total { get; set; }
        public int Count { get; set; }
    }

    public class ReportBudgetRow
    {
        public string Category { get; set; } = string.Empty;
        public decimal Limit { get; set; }
        public decimal Spent { get; set; }
        public decimal Remaining { get; set; }
        public double Percent { get; set; }
        public bool OverBudget { get; set; }
    }
}
