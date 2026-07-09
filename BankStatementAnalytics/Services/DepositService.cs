using System;
using System.Collections.Generic;
using System.Linq;
using NHibernate.Linq;
using Common.Framework.Data;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Services
{
    /// <summary>
    /// Detects savings/investment instruments — Recurring Deposits (RD) and Fixed Deposits (FD) —
    /// from a user's transaction history. Unlike bills these are money the user is *saving*, not
    /// spending, so they get their own summary rather than counting as expenses.
    ///
    /// Detection keys off signals the parsers already assign: HDFC tags RD installments with
    /// <c>Mode == "INTERNAL"</c> (counterparty "RD ...") and fixed deposits with <c>Mode == "FD"</c>
    /// (counterparty "FD ..."). Narration/counterparty-name fallbacks keep it working when Mode is
    /// unset. Nothing here is persisted — it's derived on demand, like bill suggestions.
    /// </summary>
    public class DepositService
    {
        public DepositSummary GetSummary(long userId)
        {
            using var session = DbHelper.GetSession();

            var accountIds = session.Query<Account>()
                .Where(a => a.OwnerUserId == userId)
                .Select(a => a.Id)
                .ToList();

            var summary = new DepositSummary();
            if (accountIds.Count == 0)
                return summary;

            var txns = session.Query<BankTransaction>()
                .Where(t => accountIds.Contains(t.AccountId))
                .ToList();

            // ── Recurring Deposits: monthly-recurring internal debits into an RD account ──
            var rdTxns = txns.Where(IsRecurringDeposit).ToList();
            foreach (var group in rdTxns.GroupBy(DisplayName))
            {
                var occurrences = group.OrderBy(t => t.TransactionDate).ToList();
                var installments = occurrences.Where(t => t.Debit > 0).ToList();
                if (installments.Count == 0)
                    continue;

                var monthly = Median(installments.Select(t => t.Debit).ToList());
                var dueDay = MedianInt(installments.Select(t => t.TransactionDate.Day).ToList());
                var lastDate = installments.Max(t => t.TransactionDate);

                summary.RecurringDeposits.Add(new RdPlan
                {
                    Name = group.Key,
                    MonthlyAmount = monthly,
                    InstallmentsPaid = installments.Count,
                    TotalInvested = installments.Sum(t => t.Debit),
                    LastInstallmentDate = lastDate,
                    DueDayOfMonth = dueDay,
                    NextInstallmentDate = RecurringBillService.ProjectDueDate(dueDay, DateTime.Today),
                });
            }

            // ── Fixed Deposits: lump-sum placements (debit) and their maturity/interest (credit) ──
            var fdTxns = txns.Where(IsFixedDeposit).ToList();
            foreach (var group in fdTxns.GroupBy(DisplayName))
            {
                var occurrences = group.OrderBy(t => t.TransactionDate).ToList();
                var principal = occurrences.Sum(t => t.Debit);
                var returns = occurrences.Sum(t => t.Credit);

                summary.FixedDeposits.Add(new FdEntry
                {
                    Name = group.Key,
                    Principal = principal,
                    Returns = returns,
                    PlacedOn = occurrences.FirstOrDefault(t => t.Debit > 0)?.TransactionDate
                               ?? occurrences.First().TransactionDate,
                    LastActivity = occurrences.Max(t => t.TransactionDate),
                    IsMatured = returns > 0,
                    // Gain is only meaningful once matured and we saw the original placement.
                    NetGain = returns > 0 && principal > 0 ? returns - principal : 0m,
                });
            }

            summary.RecurringDeposits = summary.RecurringDeposits
                .OrderByDescending(r => r.LastInstallmentDate).ToList();
            summary.FixedDeposits = summary.FixedDeposits
                .OrderByDescending(f => f.LastActivity).ToList();

            summary.RdPlanCount = summary.RecurringDeposits.Count;
            summary.TotalRdInvested = summary.RecurringDeposits.Sum(r => r.TotalInvested);
            summary.MonthlyRdCommitment = summary.RecurringDeposits.Sum(r => r.MonthlyAmount);
            summary.ActiveFdCount = summary.FixedDeposits.Count(f => !f.IsMatured);
            summary.TotalFdPrincipal = summary.FixedDeposits.Sum(f => f.Principal);
            summary.TotalFdReturns = summary.FixedDeposits.Sum(f => f.Returns);
            summary.TotalInvested = summary.TotalRdInvested + summary.TotalFdPrincipal;

            return summary;
        }

        // RD installment: HDFC sets Mode "INTERNAL" on "RD INSTALLMENT" narrations; fall back to
        // the counterparty/narration text so other formats still classify.
        private static bool IsRecurringDeposit(BankTransaction t) =>
            string.Equals(t.Mode, "INTERNAL", StringComparison.OrdinalIgnoreCase)
                && StartsWithRd(DisplayName(t))
            || DisplayName(t).StartsWith("RD ", StringComparison.OrdinalIgnoreCase)
            || (t.Narration ?? string.Empty).Contains("RD INSTALLMENT", StringComparison.OrdinalIgnoreCase);

        // Fixed deposit: HDFC sets Mode "FD"; fall back to the "IB FD" / "FIXED DEPOSIT" text.
        private static bool IsFixedDeposit(BankTransaction t) =>
            string.Equals(t.Mode, "FD", StringComparison.OrdinalIgnoreCase)
            || DisplayName(t).StartsWith("FD ", StringComparison.OrdinalIgnoreCase)
            || (t.Narration ?? string.Empty).Contains("IB FD", StringComparison.OrdinalIgnoreCase)
            || (t.Narration ?? string.Empty).Contains("FIXED DEPOSIT", StringComparison.OrdinalIgnoreCase);

        private static bool StartsWithRd(string name) =>
            name.StartsWith("RD", StringComparison.OrdinalIgnoreCase);

        // Prefer the linked merchant's friendly/plain name, else the narration/description.
        private static string DisplayName(BankTransaction t)
        {
            if (t.CounterParty != null)
                return !string.IsNullOrWhiteSpace(t.CounterParty.FriendlyName)
                    ? t.CounterParty.FriendlyName!
                    : t.CounterParty.Name;
            return !string.IsNullOrWhiteSpace(t.Narration) ? t.Narration : t.Description;
        }

        private static decimal Median(List<decimal> values)
        {
            var sorted = values.OrderBy(v => v).ToList();
            int n = sorted.Count;
            if (n == 0) return 0m;
            return n % 2 == 1 ? sorted[n / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2m;
        }

        private static int MedianInt(List<int> values)
        {
            var sorted = values.OrderBy(v => v).ToList();
            int n = sorted.Count;
            if (n == 0) return 1;
            return n % 2 == 1 ? sorted[n / 2] : (int)Math.Round((sorted[n / 2 - 1] + sorted[n / 2]) / 2.0);
        }
    }

    public class DepositSummary
    {
        public List<RdPlan> RecurringDeposits { get; set; } = new();
        public List<FdEntry> FixedDeposits { get; set; } = new();

        public int RdPlanCount { get; set; }
        public decimal TotalRdInvested { get; set; }
        public decimal MonthlyRdCommitment { get; set; }
        public int ActiveFdCount { get; set; }
        public decimal TotalFdPrincipal { get; set; }
        public decimal TotalFdReturns { get; set; }
        public decimal TotalInvested { get; set; }
    }

    public class RdPlan
    {
        public string Name { get; set; } = string.Empty;
        public decimal MonthlyAmount { get; set; }
        public int InstallmentsPaid { get; set; }
        public decimal TotalInvested { get; set; }
        public DateTime LastInstallmentDate { get; set; }
        public int DueDayOfMonth { get; set; }
        public DateTime NextInstallmentDate { get; set; }
    }

    public class FdEntry
    {
        public string Name { get; set; } = string.Empty;
        public decimal Principal { get; set; }
        public decimal Returns { get; set; }
        public DateTime PlacedOn { get; set; }
        public DateTime LastActivity { get; set; }
        public bool IsMatured { get; set; }
        public decimal NetGain { get; set; }
    }
}
