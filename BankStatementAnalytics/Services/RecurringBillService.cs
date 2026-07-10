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
    /// Detects monthly-recurring debits from a user's transaction history and projects when a
    /// confirmed bill is next due. The app has no live bank feed, so a "due date" is a prediction
    /// based on the day-of-month a bill has historically posted.
    /// </summary>
    public class RecurringBillService
    {
        // How stable amounts must be to count as one recurring bill (fraction of the median).
        private const decimal AmountTolerance = 0.15m;
        // Minimum distinct months a key must appear in to be considered monthly-recurring.
        private const int MinMonths = 3;
        // How far back detection looks.
        private const int LookbackMonths = 6;

        /// <summary>
        /// Auto-detected recurring-bill candidates for the user, excluding keys already
        /// confirmed or dismissed.
        /// </summary>
        public List<BillCandidate> DetectCandidates(long userId)
        {
            using var session = DbHelper.GetSession();

            var accountIds = OwnedAccountIds(session, userId);
            if (accountIds.Count == 0)
                return new List<BillCandidate>();

            var today = DateTime.Today;
            var from = new DateTime(today.Year, today.Month, 1).AddMonths(-LookbackMonths);

            var debits = session.Query<BankTransaction>()
                .Where(t => accountIds.Contains(t.AccountId) && t.Debit > 0 && t.TransactionDate >= from)
                .ToList();

            var existingKeys = session.Query<RecurringBill>()
                .Where(b => b.OwnerUserId == userId)
                .Select(b => b.MatchKey)
                .ToList()
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            var candidates = new List<BillCandidate>();

            foreach (var group in debits.GroupBy(t => BuildKey(t).Key))
            {
                var key = group.Key;
                if (existingKeys.Contains(key))
                    continue;

                var occurrences = group.ToList();

                var distinctMonths = occurrences
                    .Select(t => t.TransactionDate.Year * 12 + t.TransactionDate.Month)
                    .Distinct().Count();
                if (distinctMonths < MinMonths)
                    continue;

                var amounts = occurrences.Select(t => t.Debit).ToList();
                var median = Median(amounts);
                var withinTolerance = amounts.Count(a =>
                    median == 0m ? a == 0m : Math.Abs(a - median) / median <= AmountTolerance);
                // Require most occurrences to cluster around the median, else it's not a fixed bill.
                if (withinTolerance < Math.Ceiling(occurrences.Count * 0.6))
                    continue;

                var dueDay = MedianInt(occurrences.Select(t => t.TransactionDate.Day).ToList());
                var sample = occurrences[0];
                var (_, display) = BuildKey(sample);

                candidates.Add(new BillCandidate
                {
                    Name = display,
                    MatchKey = key,
                    CounterPartyId = sample.CounterParty?.Id,
                    ExpectedAmount = median,
                    DueDayOfMonth = dueDay,
                    LastSeenDate = occurrences.Max(t => t.TransactionDate),
                    OccurrenceCount = occurrences.Count
                });
            }

            return candidates.OrderByDescending(c => c.LastSeenDate).ToList();
        }

        /// <summary>
        /// Confirmed bills enriched with the projected next due date, days-until-due, and whether
        /// a payment has already posted for that cycle. When <paramref name="upcomingOnly"/> is set,
        /// returns only unpaid bills due within <paramref name="withinDays"/> days.
        /// </summary>
        public List<BillView> GetConfirmedBillViews(long userId, bool upcomingOnly = false, int withinDays = 7)
        {
            using var session = DbHelper.GetSession();

            var bills = session.Query<RecurringBill>()
                .Where(b => b.OwnerUserId == userId && b.Status == "Confirmed")
                .ToList();
            if (bills.Count == 0)
                return new List<BillView>();

            var today = DateTime.Today;
            var accountIds = OwnedAccountIds(session, userId);

            // Payments in the current + previous month are enough to decide "paid this cycle".
            var from = new DateTime(today.Year, today.Month, 1).AddMonths(-1);
            var paidKeys = accountIds.Count == 0
                ? new HashSet<string>()
                : session.Query<BankTransaction>()
                    .Where(t => accountIds.Contains(t.AccountId) && t.Debit > 0 && t.TransactionDate >= from)
                    .ToList()
                    .Select(t => $"{BuildKey(t).Key}|{t.TransactionDate.Year * 12 + t.TransactionDate.Month}")
                    .ToHashSet(StringComparer.OrdinalIgnoreCase);

            var views = new List<BillView>();
            foreach (var bill in bills)
            {
                var nextDue = ProjectDueDate(bill.DueDayOfMonth, today);
                var billingMonth = nextDue.Year * 12 + nextDue.Month;
                var paid = paidKeys.Contains($"{bill.MatchKey}|{billingMonth}");
                var daysUntilDue = (nextDue - today).Days;

                if (upcomingOnly && (paid || daysUntilDue > withinDays))
                    continue;

                views.Add(new BillView
                {
                    Id = bill.Id,
                    Name = bill.Name,
                    MatchKey = bill.MatchKey,
                    CounterPartyId = bill.CounterParty?.Id,
                    ExpectedAmount = bill.ExpectedAmount,
                    DueDayOfMonth = bill.DueDayOfMonth,
                    LastSeenDate = bill.LastSeenDate,
                    NextDueDate = nextDue,
                    DaysUntilDue = daysUntilDue,
                    PaidThisCycle = paid
                });
            }

            return views.OrderBy(v => v.DaysUntilDue).ToList();
        }

        /// <summary>
        /// The historical debit transactions that make up a bill — every debit whose grouping key
        /// matches the bill's <see cref="RecurringBill.MatchKey"/>, newest first.
        /// </summary>
        public List<BillTransaction> GetMatchingTransactions(long userId, RecurringBill bill)
        {
            using var session = DbHelper.GetSession();

            var accountIds = OwnedAccountIds(session, userId);
            if (accountIds.Count == 0)
                return new List<BillTransaction>();

            return session.Query<BankTransaction>()
                .Where(t => accountIds.Contains(t.AccountId) && t.Debit > 0)
                .ToList()
                // Same key AND a similar amount, so one-off payments to the same merchant
                // (a different-sized charge) don't get mixed into this recurring bill.
                .Where(t => BuildKey(t).Key == bill.MatchKey && IsAmountClose(t.Debit, bill.ExpectedAmount))
                .OrderByDescending(t => t.TransactionDate)
                .Select(t => new BillTransaction
                {
                    Date = t.TransactionDate,
                    Amount = t.Debit,
                    Description = t.CounterParty != null
                        ? (!string.IsNullOrWhiteSpace(t.CounterParty.FriendlyName) ? t.CounterParty.FriendlyName! : t.CounterParty.Name)
                        : (!string.IsNullOrWhiteSpace(t.Narration) ? t.Narration : t.Description),
                    Mode = t.Mode,
                    BankReference = t.BankReference
                })
                .ToList();
        }

        /// <summary>Next occurrence of <paramref name="dueDay"/> on or after today (day clamped to month length).</summary>
        public static DateTime ProjectDueDate(int dueDay, DateTime today)
        {
            var day = Math.Clamp(dueDay, 1, DateTime.DaysInMonth(today.Year, today.Month));
            var candidate = new DateTime(today.Year, today.Month, day);
            if (candidate < today)
            {
                var nextMonth = new DateTime(today.Year, today.Month, 1).AddMonths(1);
                day = Math.Clamp(dueDay, 1, DateTime.DaysInMonth(nextMonth.Year, nextMonth.Month));
                candidate = new DateTime(nextMonth.Year, nextMonth.Month, day);
            }
            return candidate;
        }

        // Whether a transaction amount is close enough to the bill's expected amount to count.
        private static bool IsAmountClose(decimal amount, decimal expected) =>
            expected == 0m ? amount == 0m : Math.Abs(amount - expected) / expected <= AmountTolerance;

        private static List<long> OwnedAccountIds(NHibernate.ISession session, long userId) =>
            session.Query<Account>()
                .Where(a => a.OwnerUserId == userId)
                .Select(a => a.Id)
                .ToList();

        // A transaction's grouping key: prefer the linked merchant, else a normalized narration.
        private static (string Key, string Display) BuildKey(BankTransaction t)
        {
            if (t.CounterParty != null)
            {
                var name = !string.IsNullOrWhiteSpace(t.CounterParty.FriendlyName)
                    ? t.CounterParty.FriendlyName!
                    : t.CounterParty.Name;
                return ($"M:{t.CounterParty.Id}", name);
            }

            var source = !string.IsNullOrWhiteSpace(t.Narration) ? t.Narration : t.Description;
            var norm = NormalizeNarration(source);
            return ($"N:{norm}", ToTitleCase(norm));
        }

        /// <summary>Grouping key for a manually-added bill, derived from its display name so it
        /// still matches the same normalized-narration transactions detection would have found.</summary>
        public static string BuildManualKey(string name) => "N:" + NormalizeNarration(name);

        private static string NormalizeNarration(string s)
        {
            if (string.IsNullOrWhiteSpace(s)) return "unknown";
            var sb = new StringBuilder();
            foreach (var c in s.ToUpperInvariant())
                sb.Append(char.IsLetter(c) ? c : ' ');
            var collapsed = Regex.Replace(sb.ToString(), "\\s+", " ").Trim();
            // Keep the first few meaningful tokens so varying reference numbers don't split groups.
            var tokens = collapsed.Split(' ').Where(tok => tok.Length > 2).Take(4);
            var result = string.Join(" ", tokens);
            return result.Length == 0 ? "unknown" : result;
        }

        private static string ToTitleCase(string s) =>
            string.IsNullOrEmpty(s)
                ? s
                : System.Globalization.CultureInfo.InvariantCulture.TextInfo.ToTitleCase(s.ToLowerInvariant());

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

    public class BillCandidate
    {
        public string Name { get; set; } = string.Empty;
        public string MatchKey { get; set; } = string.Empty;
        public int? CounterPartyId { get; set; }
        public decimal ExpectedAmount { get; set; }
        public int DueDayOfMonth { get; set; }
        public DateTime LastSeenDate { get; set; }
        public int OccurrenceCount { get; set; }
    }

    public class BillTransaction
    {
        public DateTime Date { get; set; }
        public decimal Amount { get; set; }
        public string Description { get; set; } = string.Empty;
        public string Mode { get; set; } = string.Empty;
        public string BankReference { get; set; } = string.Empty;
    }

    public class BillView
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public string MatchKey { get; set; } = string.Empty;
        public int? CounterPartyId { get; set; }
        public decimal ExpectedAmount { get; set; }
        public int DueDayOfMonth { get; set; }
        public DateTime? LastSeenDate { get; set; }
        public DateTime NextDueDate { get; set; }
        public int DaysUntilDue { get; set; }
        public bool PaidThisCycle { get; set; }
    }
}
