using System;
using System.Collections.Generic;
using System.Linq;
using NHibernate.Linq;
using Common.Framework.Data;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Services
{
    public class ForecastService
    {
        private readonly RecurringBillService _billService;

        public ForecastService(RecurringBillService billService)
        {
            _billService = billService;
        }

        public ForecastResult GenerateForecast(long userId, int? accountId = null, string? accountIds = null, int daysAhead = 60)
        {
            using var session = DbHelper.GetSession();

            var ownedIds = AccountAccess.OwnedIdSet(session, userId);
            var (status, ids) = AccountAccess.ResolveScope(ownedIds, accountIds, accountId ?? 0);
            if (status == AccountAccess.ScopeStatus.NotFound || ids.Count == 0)
            {
                return new ForecastResult
                {
                    StartingBalance = 0,
                    Projections = new List<DailyProjection>(),
                    Alerts = new List<string>()
                };
            }

            var today = DateTime.Today;
            var horizon = today.AddDays(Math.Clamp(daysAhead, 15, 90));

            // 1. Get current balances (latest transaction balance per account)
            decimal startingBalance = 0;
            foreach (var accId in ids)
            {
                var latest = session.Query<BankTransaction>()
                    .Where(t => t.AccountId == accId)
                    .OrderByDescending(t => t.TransactionDate)
                    .Select(t => (decimal?)t.Balance)
                    .FirstOrDefault();

                if (latest.HasValue)
                    startingBalance += latest.Value;
            }

            // 2. Discretionary daily spend estimate based on trailing 60 days
            var past60Days = today.AddDays(-60);
            var pastDebits = session.Query<BankTransaction>()
                .ExcludeOwnMoneyMoves()
                .Where(t => ids.Contains(t.AccountId) && t.Debit > 0 && t.TransactionDate >= past60Days && t.TransactionDate < today)
                .Select(t => t.Debit)
                .ToList();

            var totalPastDebits = pastDebits.Sum();
            var totalDays = Math.Max(1, (today - past60Days).Days);

            // 3. Upcoming confirmed bills from RecurringBillService
            var confirmedBills = _billService.GetConfirmedBillViews(userId);

            // 4. Expected salary/income detection (recurring monthly credits in trailing 90 days)
            var pastCredits = session.Query<BankTransaction>()
                .ExcludeOwnMoneyMoves()
                .Where(t => ids.Contains(t.AccountId) && t.Credit > 0 && t.TransactionDate >= today.AddDays(-90))
                .Select(t => new
                {
                    Date = t.EffectiveDate ?? t.TransactionDate,
                    Amount = t.Credit,
                    MerchantName = t.CounterParty != null ? t.CounterParty.Name : t.Description
                })
                .ToList();

            // Detect monthly salary if consistent credit occurs in 2+ months
            var salaryCandidates = pastCredits
                .GroupBy(c => new { Key = c.MerchantName?.Trim().ToUpperInvariant() ?? "", ApproxAmount = Math.Round(c.Amount / 1000) * 1000 })
                .Where(g => g.Count() >= 2 && g.Key.ApproxAmount >= 10000)
                .Select(g => new
                {
                    Name = g.First().MerchantName,
                    Amount = g.Average(x => x.Amount),
                    TypicalDay = (int)Math.Round(g.Average(x => x.Date.Day))
                })
                .ToList();

            // Subtract detected monthly bills from past debits to isolate purely discretionary daily spend
            var monthlyBillSum = confirmedBills.Sum(b => b.ExpectedAmount);
            var estimatedDiscretionarySpend = Math.Max(0, (totalPastDebits - (monthlyBillSum * 2)) / totalDays);

            // Build Day-by-Day Forecast
            var projections = new List<DailyProjection>();
            var alerts = new List<string>();
            decimal runningBalance = startingBalance;
            var lowestBalance = startingBalance;
            DateTime? lowDate = null;

            for (var d = today; d <= horizon; d = d.AddDays(1))
            {
                var events = new List<string>();
                decimal dayIncome = 0;
                decimal dayBills = 0;

                // Check salary
                foreach (var sal in salaryCandidates)
                {
                    if (d.Day == Math.Min(sal.TypicalDay, DateTime.DaysInMonth(d.Year, d.Month)))
                    {
                        dayIncome += sal.Amount;
                        events.Add($"Salary / Income: +₹{sal.Amount:N0}");
                    }
                }

                // Check bills
                foreach (var b in confirmedBills)
                {
                    var dueDay = Math.Min(b.DueDayOfMonth, DateTime.DaysInMonth(d.Year, d.Month));
                    if (d.Day == dueDay)
                    {
                        dayBills += b.ExpectedAmount;
                        events.Add($"{b.Name}: -₹{b.ExpectedAmount:N0}");
                    }
                }

                runningBalance = runningBalance + dayIncome - dayBills - estimatedDiscretionarySpend;

                if (runningBalance < lowestBalance)
                {
                    lowestBalance = runningBalance;
                    lowDate = d;
                }

                projections.Add(new DailyProjection
                {
                    Date = d.ToString("yyyy-MM-dd"),
                    Balance = Math.Round(runningBalance, 2),
                    DailySpend = Math.Round(estimatedDiscretionarySpend + dayBills, 2),
                    DailyIncome = Math.Round(dayIncome, 2),
                    Events = events
                });
            }

            if (lowestBalance < 0 && lowDate.HasValue)
            {
                alerts.Add($"Projected deficit on {lowDate.Value:dd MMM yyyy}: balance may dip to ₹{lowestBalance:N0}");
            }
            else if (lowestBalance < 5000 && lowDate.HasValue)
            {
                alerts.Add($"Low balance warning on {lowDate.Value:dd MMM yyyy}: projected at ₹{lowestBalance:N0}");
            }

            return new ForecastResult
            {
                StartingBalance = startingBalance,
                LowestProjectedBalance = Math.Round(lowestBalance, 2),
                LowestBalanceDate = lowDate?.ToString("yyyy-MM-dd"),
                EstimatedDailySpend = Math.Round(estimatedDiscretionarySpend, 2),
                Projections = projections,
                Alerts = alerts
            };
        }
    }

    public class ForecastResult
    {
        public decimal StartingBalance { get; set; }
        public decimal LowestProjectedBalance { get; set; }
        public string? LowestBalanceDate { get; set; }
        public decimal EstimatedDailySpend { get; set; }
        public List<DailyProjection> Projections { get; set; } = new List<DailyProjection>();
        public List<string> Alerts { get; set; } = new List<string>();
    }

    public class DailyProjection
    {
        public string Date { get; set; } = string.Empty;
        public decimal Balance { get; set; }
        public decimal DailySpend { get; set; }
        public decimal DailyIncome { get; set; }
        public List<string> Events { get; set; } = new List<string>();
    }
}
