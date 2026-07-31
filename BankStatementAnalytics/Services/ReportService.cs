using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using NHibernate.Linq;
using Common.Framework.Data;
using BankStatementAnalytics.EnumClass;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Services
{
    /// <summary>
    /// Composes the monthly / yearly report payload served by <c>api/reports</c>.
    /// The income/spend/category/merchant and deposit sections are scoped to the requested
    /// accounts; budgets and bills are user-level (all owned accounts), matching how their
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

        // Half-open [start, end) bounds for the requested period, shared by the report itself
        // and the drill-down list so both slice the data identically.
        private static (DateTime Start, DateTime End) PeriodBounds(bool yearly, int year, int month)
        {
            var start = yearly ? new DateTime(year, 1, 1) : new DateTime(year, month, 1);
            return (start, yearly ? start.AddYears(1) : start.AddMonths(1));
        }

        public async Task<ReportView> BuildAsync(long userId, List<long> accountIds, bool yearly, int year, int month)
        {
            var (start, end) = PeriodBounds(yearly, year, month);

            using var session = DbHelper.GetSession();

            // Narrow projection: only the fields the report sections read, not whole entities.
            // COALESCE(EffectiveDate, TransactionDate) attributes month-end salaries from
            // merchants flagged ShiftToNextMonth to the following month; the month part is
            // extracted in memory to keep the SQL translation trivial.
            var txns = await session.Query<BankTransaction>()
                .ExcludeOwnMoneyMoves()
                .Where(t => accountIds.Contains(t.AccountId)
                         && (t.EffectiveDate ?? t.TransactionDate) >= start
                         && (t.EffectiveDate ?? t.TransactionDate) < end)
                .Select(t => new ReportRow
                {
                    Credit = t.Credit,
                    Debit = t.Debit,
                    Date = t.EffectiveDate ?? t.TransactionDate,
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

            var (opening, closing) = await BuildBalancesAsync(session, accountIds, start, end);
            report.Summary.OpeningBalance = opening;
            report.Summary.ClosingBalance = closing;

            if (yearly)
            {
                report.MonthlySeries = Enumerable.Range(1, 12).Select(m => new ReportMonthBucket
                {
                    Month = m,
                    Label = new DateTime(year, m, 1).ToString("MMM"),
                    Income = txns.Where(t => t.Date.Month == m).Sum(t => t.Credit),
                    Spend = txns.Where(t => t.Date.Month == m).Sum(t => t.Debit),
                }).ToList();
            }

            var debits = txns.Where(t => t.Debit > 0).ToList();

            report.ByCategory = debits
                .GroupBy(t => t.CategoryOverride ?? t.MerchantCategory ?? "Uncategorized")
                .Select(g => new ReportGroupTotal { Name = g.Key, Total = g.Sum(t => t.Debit), Count = g.Count() })
                .OrderByDescending(x => x.Total)
                .ToList();

            // Full ranked list — the UI scrolls it, the PDF prints all of it.
            report.TopMerchants = debits
                .Where(t => t.MerchantName != null)
                .GroupBy(t => t.MerchantName!)
                .Select(g => new ReportGroupTotal { Name = g.Key, Total = g.Sum(t => t.Debit), Count = g.Count() })
                .OrderByDescending(x => x.Total)
                .ToList();

            report.Budgets = await BuildBudgetsAsync(session, userId, yearly, year, start, end);
            report.Bills = _bills.GetPaymentsInPeriod(userId, start, end);
            report.Deposits = _deposits.GetContributionsInPeriod(userId, start, end, accountIds);

            return report;
        }

        /// <summary>
        /// The individual transactions behind a summary tile, for the Reports page's drill-down
        /// drawer. Filtered exactly like <see cref="BuildAsync"/>'s totals — same accounts, same
        /// effective-date window, own-money moves excluded — so the rows always add up to the
        /// tile that was clicked. <paramref name="kind"/> is "income", "spend", or anything else
        /// for both sides.
        /// </summary>
        public async Task<List<ReportTransaction>> GetTransactionsAsync(
            List<long> accountIds, bool yearly, int year, int month, string? kind)
        {
            var (start, end) = PeriodBounds(yearly, year, month);

            using var session = DbHelper.GetSession();

            var query = session.Query<BankTransaction>()
                .ExcludeOwnMoneyMoves()
                .Where(t => accountIds.Contains(t.AccountId)
                         && (t.EffectiveDate ?? t.TransactionDate) >= start
                         && (t.EffectiveDate ?? t.TransactionDate) < end);

            query = kind switch
            {
                "income" => query.Where(t => t.Credit > 0),
                "spend" => query.Where(t => t.Debit > 0),
                _ => query,
            };

            return await query
                .OrderByDescending(t => t.EffectiveDate ?? t.TransactionDate)
                .Select(t => new ReportTransaction
                {
                    Id = t.BankReference,
                    Date = t.EffectiveDate ?? t.TransactionDate,
                    AccountId = t.AccountId,
                    Description = t.Description,
                    Merchant = t.CounterParty != null ? t.CounterParty.Name : null,
                    Category = t.CategoryOverride ?? (t.CounterParty != null ? t.CounterParty.Category : null),
                    Debit = t.Debit,
                    Credit = t.Credit,
                })
                .ToListAsync();
        }

        /// <summary>
        /// Bank balance at the first and last instant of the period, summed over the requested
        /// accounts. Reads the statement's own running balance rather than Σ(credits − debits),
        /// so it stays right even when history before the first uploaded statement is missing.
        /// Unlike the income/spend sections this counts <i>every</i> row (own-money moves
        /// included) and keys off the real <see cref="BankTransaction.TransactionDate"/>, since
        /// that is what the bank's running balance follows — meaning closing − opening will not
        /// generally equal <see cref="ReportSummary.Net"/>.
        /// Credit cards carry no running balance and are skipped; null means no account in the
        /// selection had usable balance data.
        /// </summary>
        private static async Task<(decimal? Opening, decimal? Closing)> BuildBalancesAsync(
            NHibernate.ISession session, List<long> accountIds, DateTime start, DateTime end)
        {
            var balanceAccountIds = await session.Query<Account>()
                .Where(a => accountIds.Contains(a.Id) && a.BankName != Bank.HDFCCreditCard)
                .Select(a => a.Id)
                .ToListAsync();

            decimal? opening = null, closing = null;

            foreach (var id in balanceAccountIds)
            {
                var txns = session.Query<BankTransaction>().Where(t => t.AccountId == id);

                // Balance == 0 means the parser captured none, so such rows can't anchor.
                // No surrogate Id on BankTransaction; ImportedOn breaks same-date ties.
                var before = await txns
                    .Where(t => t.TransactionDate < start && t.Balance != 0)
                    .OrderByDescending(t => t.TransactionDate)
                    .ThenByDescending(t => t.ImportedOn)
                    .Select(t => (decimal?)t.Balance)
                    .FirstOrDefaultAsync();

                // Nothing before the period (statements start mid-history): back the opening
                // balance out of the first in-period row, whose balance is post-transaction.
                if (before == null)
                {
                    var first = await txns
                        .Where(t => t.TransactionDate >= start && t.TransactionDate < end && t.Balance != 0)
                        .OrderBy(t => t.TransactionDate)
                        .ThenBy(t => t.ImportedOn)
                        .Select(t => new { t.Balance, t.Credit, t.Debit })
                        .FirstOrDefaultAsync();
                    if (first != null)
                        before = first.Balance - first.Credit + first.Debit;
                }

                // Falls back to the pre-period balance when the account saw no activity.
                var last = await txns
                    .Where(t => t.TransactionDate < end && t.Balance != 0)
                    .OrderByDescending(t => t.TransactionDate)
                    .ThenByDescending(t => t.ImportedOn)
                    .Select(t => (decimal?)t.Balance)
                    .FirstOrDefaultAsync();

                if (before != null) opening = (opening ?? 0m) + before.Value;
                if (last != null) closing = (closing ?? 0m) + last.Value;
                else if (before != null) closing = (closing ?? 0m) + before.Value;
            }

            return (opening, closing);
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
                    .ExcludeOwnMoneyMoves() // own-money moves don't consume budgets
                    .Where(t => ownedIds.Contains(t.AccountId) && t.Debit > 0
                             && (t.EffectiveDate ?? t.TransactionDate) >= start
                             && (t.EffectiveDate ?? t.TransactionDate) < end)
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
        public DateTime Date { get; set; } // effective (month-attribution) date
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

        // Running bank balance at the period's edges; null when no selected account carries
        // one (credit-card-only selection, or statements with no balance column parsed).
        public decimal? OpeningBalance { get; set; }
        public decimal? ClosingBalance { get; set; }
    }

    // One row in the summary-tile drill-down list.
    public class ReportTransaction
    {
        public string Id { get; set; } = string.Empty;
        public DateTime Date { get; set; }
        public long AccountId { get; set; }
        public string Description { get; set; } = string.Empty;
        public string? Merchant { get; set; }
        public string? Category { get; set; }
        public decimal Debit { get; set; }
        public decimal Credit { get; set; }
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
