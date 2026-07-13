using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using NHibernate.Linq;
using Common.Framework.Data;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Services
{
    /// <summary>
    /// Detects savings/investment instruments — Recurring Deposits (RD) and Fixed Deposits (FD) —
    /// from a user's transaction history, and merges them with any user-entered
    /// <see cref="Deposit"/> metadata (nickname, interest rate, maturity date, tenure).
    ///
    /// Detection groups by the deposit *account number* extracted from the narration, NOT the
    /// merchant name: an RD installment narration like "50400377672222- RD INSTALLMENT-JUL 2026"
    /// embeds the month, so grouping by name splits one deposit into a fragment per month. Keying
    /// on the account number collapses those fragments back into the single real deposit (and also
    /// merges alternate narrations for the same account, e.g. "RD THROUGH MOBILE-50400379172072").
    ///
    /// Nothing detected is persisted — figures are recomputed on demand, like bill suggestions.
    /// Only the metadata a user types is stored (in <see cref="Deposit"/>).
    /// </summary>
    public class DepositService
    {
        // Deposit account numbers are long digit runs; a statement date ("2026") is only 4 digits,
        // so a 6+ digit run reliably isolates the account number in the narration.
        private static readonly Regex AccountNumRegex = new(@"\d{6,}", RegexOptions.Compiled);

        public DepositSummary GetSummary(long userId)
        {
            using var session = DbHelper.GetSession();

            var accountIds = OwnedAccountIds(session, userId);
            var summary = new DepositSummary();
            if (accountIds.Count == 0)
                return summary;

            var txns = session.Query<BankTransaction>()
                .Where(t => accountIds.Contains(t.AccountId))
                .ProjectDetection()
                .ToList();

            var meta = session.Query<Deposit>()
                .Where(d => d.OwnerUserId == userId)
                .ToList()
                .ToDictionary(d => MetaKey(d.Kind, d.MatchKey), d => d, StringComparer.OrdinalIgnoreCase);

            // ── Recurring Deposits ──────────────────────────────────────────────
            foreach (var group in txns.Where(IsRecurringDeposit).GroupBy(GroupKey))
            {
                var installments = group.Where(t => t.Debit > 0).OrderBy(t => t.TransactionDate).ToList();
                if (installments.Count == 0)
                    continue;

                var key = group.Key;
                meta.TryGetValue(MetaKey("RD", key), out var m);

                var monthly = DetectionMath.Median(installments.Select(t => t.Debit).ToList());
                var dueDay = DetectionMath.MedianInt(installments.Select(t => t.TransactionDate.Day).ToList());
                var first = installments.Min(t => t.TransactionDate);
                var last = installments.Max(t => t.TransactionDate);

                var plan = new RdPlan
                {
                    MatchKey = key,
                    Name = m?.Nickname ?? DefaultName("RD", installments[0]),
                    MonthlyAmount = monthly,
                    InstallmentsPaid = installments.Count,
                    TotalInvested = installments.Sum(t => t.Debit),
                    FirstInstallmentDate = first,
                    LastInstallmentDate = last,
                    DueDayOfMonth = dueDay,
                    NextInstallmentDate = RecurringBillService.ProjectDueDate(dueDay, DateTime.Today),
                    InterestRate = m?.InterestRate,
                    TermMonths = m?.TermMonths,
                    Note = m?.Note,
                };

                if (m?.TermMonths is int term && term > 0)
                {
                    plan.MonthsRemaining = Math.Max(0, term - installments.Count);
                    plan.ProgressPct = Math.Min(100, (int)Math.Round(installments.Count * 100.0 / term));
                    plan.MaturityValue = monthly * term;
                }
                // Explicit maturity date wins; otherwise derive it from tenure.
                plan.MaturityDate = m?.MaturityDate
                    ?? (m?.TermMonths is int t2 && t2 > 0 ? first.AddMonths(t2) : (DateTime?)null);

                summary.RecurringDeposits.Add(plan);
            }

            // ── Fixed Deposits ──────────────────────────────────────────────────
            foreach (var group in txns.Where(IsFixedDeposit).GroupBy(GroupKey))
            {
                var occurrences = group.OrderBy(t => t.TransactionDate).ToList();
                var key = group.Key;
                meta.TryGetValue(MetaKey("FD", key), out var m);

                var principal = occurrences.Sum(t => t.Debit);
                var returns = occurrences.Sum(t => t.Credit);
                var placedOn = occurrences.FirstOrDefault(t => t.Debit > 0)?.TransactionDate
                               ?? occurrences.First().TransactionDate;

                var fd = new FdEntry
                {
                    MatchKey = key,
                    Name = m?.Nickname ?? DefaultName("FD", occurrences[0]),
                    Principal = principal,
                    Returns = returns,
                    PlacedOn = placedOn,
                    LastActivity = occurrences.Max(t => t.TransactionDate),
                    IsMatured = returns > 0,
                    NetGain = returns > 0 && principal > 0 ? returns - principal : 0m,
                    InterestRate = m?.InterestRate,
                    MaturityDate = m?.MaturityDate,
                    Note = m?.Note,
                };

                if (fd.MaturityDate is DateTime maturity)
                {
                    fd.DaysToMaturity = (maturity.Date - DateTime.Today).Days;
                    // Simple-interest projection over the placed→maturity span.
                    if (m?.InterestRate is decimal rate && principal > 0)
                    {
                        var years = (decimal)(maturity - placedOn).TotalDays / 365m;
                        fd.MaturityValue = Math.Round(principal * (1 + rate / 100m * years), 0);
                    }
                }

                summary.FixedDeposits.Add(fd);
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

        /// <summary>
        /// RD/FD activity within [start, end): total RD installments paid, FD principal placed,
        /// FD returns credited, plus a per-deposit line-item list. Uses the same detection and
        /// grouping rules as <see cref="GetSummary"/> so a deposit reports under the same name.
        /// </summary>
        public DepositPeriodSummary GetContributionsInPeriod(long userId, DateTime start, DateTime end)
        {
            using var session = DbHelper.GetSession();

            var result = new DepositPeriodSummary();
            var accountIds = OwnedAccountIds(session, userId);
            if (accountIds.Count == 0)
                return result;

            var txns = session.Query<BankTransaction>()
                .Where(t => accountIds.Contains(t.AccountId)
                         && t.TransactionDate >= start && t.TransactionDate < end)
                .ProjectDetection()
                .ToList();

            var meta = session.Query<Deposit>()
                .Where(d => d.OwnerUserId == userId)
                .ToList()
                .ToDictionary(d => MetaKey(d.Kind, d.MatchKey), d => d, StringComparer.OrdinalIgnoreCase);

            foreach (var group in txns.Where(IsRecurringDeposit).GroupBy(GroupKey))
            {
                var installments = group.Where(t => t.Debit > 0).ToList();
                if (installments.Count == 0)
                    continue;

                meta.TryGetValue(MetaKey("RD", group.Key), out var m);
                result.Items.Add(new DepositPeriodItem
                {
                    Kind = "RD",
                    Name = m?.Nickname ?? DefaultName("RD", group.First()),
                    Invested = installments.Sum(t => t.Debit),
                    Installments = installments.Count,
                });
            }

            foreach (var group in txns.Where(IsFixedDeposit).GroupBy(GroupKey))
            {
                var placed = group.Sum(t => t.Debit);
                var returned = group.Sum(t => t.Credit);
                if (placed <= 0 && returned <= 0)
                    continue;

                meta.TryGetValue(MetaKey("FD", group.Key), out var m);
                result.Items.Add(new DepositPeriodItem
                {
                    Kind = "FD",
                    Name = m?.Nickname ?? DefaultName("FD", group.First()),
                    Invested = placed,
                    Returns = returned,
                });
            }

            result.Items = result.Items
                .OrderByDescending(i => Math.Max(i.Invested, i.Returns))
                .ToList();
            result.RdInvested = result.Items.Where(i => i.Kind == "RD").Sum(i => i.Invested);
            result.FdPlaced = result.Items.Where(i => i.Kind == "FD").Sum(i => i.Invested);
            result.FdReturns = result.Items.Where(i => i.Kind == "FD").Sum(i => i.Returns);
            result.TotalInvested = result.RdInvested + result.FdPlaced;

            return result;
        }

        /// <summary>The individual transactions behind one detected deposit, newest first.</summary>
        public List<DepositTxn> GetTransactions(long userId, string kind, string matchKey)
        {
            using var session = DbHelper.GetSession();

            var accountIds = OwnedAccountIds(session, userId);
            if (accountIds.Count == 0 || string.IsNullOrWhiteSpace(matchKey))
                return new List<DepositTxn>();

            var isRd = string.Equals(kind, "RD", StringComparison.OrdinalIgnoreCase);

            return session.Query<BankTransaction>()
                .Where(t => accountIds.Contains(t.AccountId))
                .ProjectDetection()
                .ToList()
                .Where(t => (isRd ? IsRecurringDeposit(t) : IsFixedDeposit(t))
                            && GroupKey(t) == matchKey)
                .OrderByDescending(t => t.TransactionDate)
                .Select(t => new DepositTxn
                {
                    Date = t.TransactionDate,
                    Amount = t.Debit > 0 ? t.Debit : t.Credit,
                    IsCredit = t.Credit > 0,
                    Description = !string.IsNullOrWhiteSpace(t.Narration) ? t.Narration! : t.Description ?? string.Empty,
                    BankReference = t.BankReference,
                })
                .ToList();
        }

        // ── Detection ───────────────────────────────────────────────────────────

        // RD installment: HDFC sets Mode "INTERNAL" on "RD INSTALLMENT" narrations; the standalone
        // "RD THROUGH MOBILE" narration falls through to Mode "OTHER" but still names the merchant "RD".
        private static bool IsRecurringDeposit(DetectionTxn t) =>
            (string.Equals(t.Mode, "INTERNAL", StringComparison.OrdinalIgnoreCase)
                && DisplayName(t).StartsWith("RD", StringComparison.OrdinalIgnoreCase))
            || DisplayName(t).StartsWith("RD ", StringComparison.OrdinalIgnoreCase)
            || (t.Narration ?? string.Empty).Contains("RD INSTALLMENT", StringComparison.OrdinalIgnoreCase);

        private static bool IsFixedDeposit(DetectionTxn t) =>
            string.Equals(t.Mode, "FD", StringComparison.OrdinalIgnoreCase)
            || DisplayName(t).StartsWith("FD ", StringComparison.OrdinalIgnoreCase)
            || (t.Narration ?? string.Empty).Contains("IB FD", StringComparison.OrdinalIgnoreCase)
            || (t.Narration ?? string.Empty).Contains("FIXED DEPOSIT", StringComparison.OrdinalIgnoreCase);

        // Grouping key: the deposit account number from the narration (stable across months and
        // across alternate narrations for the same account). Falls back to a normalized name.
        private static string GroupKey(DetectionTxn t)
        {
            var acct = ExtractAccountNumber(t);
            return acct ?? ("N:" + NormalizeName(DisplayName(t)));
        }

        private static string? ExtractAccountNumber(DetectionTxn t)
        {
            var source = $"{t.Narration} {t.Description}";
            var m = AccountNumRegex.Match(source);
            return m.Success ? m.Value : null;
        }

        // ── Helpers ─────────────────────────────────────────────────────────────

        private static string DefaultName(string kind, DetectionTxn sample)
        {
            var acct = ExtractAccountNumber(sample);
            if (acct != null)
                return $"{kind} ••{acct[^Math.Min(4, acct.Length)..]}";
            var name = DisplayName(sample);
            return string.IsNullOrWhiteSpace(name) ? kind : name;
        }

        private static string DisplayName(DetectionTxn t) =>
            t.MerchantDisplay
            ?? (!string.IsNullOrWhiteSpace(t.Narration) ? t.Narration! : t.Description ?? string.Empty);

        private static string NormalizeName(string s)
        {
            if (string.IsNullOrWhiteSpace(s)) return "unknown";
            var sb = new StringBuilder();
            foreach (var c in s.ToUpperInvariant())
                sb.Append(char.IsLetterOrDigit(c) ? c : ' ');
            return Regex.Replace(sb.ToString(), "\\s+", " ").Trim();
        }

        private static string MetaKey(string kind, string matchKey) => $"{kind}|{matchKey}";

        private static List<long> OwnedAccountIds(NHibernate.ISession session, long userId) =>
            AccountAccess.OwnedIds(session, userId);
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
        public string MatchKey { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public decimal MonthlyAmount { get; set; }
        public int InstallmentsPaid { get; set; }
        public decimal TotalInvested { get; set; }
        public DateTime FirstInstallmentDate { get; set; }
        public DateTime LastInstallmentDate { get; set; }
        public int DueDayOfMonth { get; set; }
        public DateTime NextInstallmentDate { get; set; }

        // User metadata / progress (null until the user fills it in).
        public decimal? InterestRate { get; set; }
        public int? TermMonths { get; set; }
        public DateTime? MaturityDate { get; set; }
        public int? MonthsRemaining { get; set; }
        public int? ProgressPct { get; set; }
        public decimal? MaturityValue { get; set; }
        public string? Note { get; set; }
    }

    public class FdEntry
    {
        public string MatchKey { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public decimal Principal { get; set; }
        public decimal Returns { get; set; }
        public DateTime PlacedOn { get; set; }
        public DateTime LastActivity { get; set; }
        public bool IsMatured { get; set; }
        public decimal NetGain { get; set; }

        public decimal? InterestRate { get; set; }
        public DateTime? MaturityDate { get; set; }
        public int? DaysToMaturity { get; set; }
        public decimal? MaturityValue { get; set; }
        public string? Note { get; set; }
    }

    public class DepositPeriodSummary
    {
        public List<DepositPeriodItem> Items { get; set; } = new();
        public decimal RdInvested { get; set; }
        public decimal FdPlaced { get; set; }
        public decimal FdReturns { get; set; }
        public decimal TotalInvested { get; set; }
    }

    public class DepositPeriodItem
    {
        public string Kind { get; set; } = string.Empty; // "RD" | "FD"
        public string Name { get; set; } = string.Empty;
        public decimal Invested { get; set; }
        public decimal Returns { get; set; }
        public int Installments { get; set; }
    }

    public class DepositTxn
    {
        public DateTime Date { get; set; }
        public decimal Amount { get; set; }
        public bool IsCredit { get; set; }
        public string Description { get; set; } = string.Empty;
        public string BankReference { get; set; } = string.Empty;
    }
}
