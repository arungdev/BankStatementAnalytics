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
    /// Detects recurring debits (weekly, monthly, quarterly, yearly) from a user's transaction
    /// history and projects when a confirmed bill is next due. The app has no live bank feed,
    /// so a "due date" is a prediction from the pattern the bill has historically posted on.
    /// </summary>
    public class RecurringBillService
    {
        // How stable amounts must be to count as one recurring bill (fraction of the median).
        private const decimal AmountTolerance = 0.15m;
        // Minimum distinct months a key must appear in to be considered monthly-recurring.
        private const int MinMonths = 3;
        // How far back monthly detection looks.
        private const int LookbackMonths = 6;
        // How far back non-monthly cadence detection looks (yearly needs 2+ occurrences).
        private const int ExtendedLookbackMonths = 24;

        // Non-monthly cadences: expected gap range in days and minimum occurrences.
        private static readonly (string Cadence, int MinGap, int MaxGap, int MinOccurrences, int IntervalDays)[]
            IntervalCadences =
        {
            ("Weekly",    5,  10,  4,   7),
            ("Quarterly", 80, 100, 3,  91),
            ("Yearly",   330, 400, 2, 365),
        };

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
            var monthlyFrom = new DateTime(today.Year, today.Month, 1).AddMonths(-LookbackMonths);
            var extendedFrom = today.AddMonths(-ExtendedLookbackMonths);

            var debits = session.Query<BankTransaction>()
                // Own-money moves (CC bill payments, inter-account transfers) aren't bills.
                .ExcludeOwnMoneyMoves()
                .Where(t => accountIds.Contains(t.AccountId) && t.Debit > 0 && t.TransactionDate >= extendedFrom)
                .ProjectDetection()
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

                var occurrences = group.OrderBy(t => t.TransactionDate).ToList();

                var candidate = TryMonthlyCandidate(occurrences, monthlyFrom)
                             ?? TryIntervalCandidate(occurrences, today);
                if (candidate == null)
                    continue;

                var sample = occurrences[0];
                var (_, display) = BuildKey(sample);
                candidate.Name = display;
                candidate.MatchKey = key;
                candidate.CounterPartyId = sample.CounterPartyId;

                candidates.Add(candidate);
            }

            return candidates.OrderByDescending(c => c.LastSeenDate).ToList();
        }

        // Monthly rule: 3+ distinct months within the 6-month window, spaced roughly a month
        // apart, with amounts clustered around the median.
        private static BillCandidate? TryMonthlyCandidate(List<DetectionTxn> occurrences, DateTime from)
        {
            var recent = occurrences.Where(t => t.TransactionDate >= from).ToList();
            if (recent.Count == 0)
                return null;

            var distinctMonths = recent
                .Select(t => t.TransactionDate.Year * 12 + t.TransactionDate.Month)
                .Distinct().Count();
            if (distinctMonths < MinMonths)
                return null;

            // Distinct months alone would also match a quarterly bill (Jan/Apr/Jul) or a weekly
            // one spanning three months, so the typical spacing has to look monthly too. The
            // upper bound stays loose enough to tolerate a skipped month.
            var medianGap = MedianGapDays(recent);
            if (medianGap == null || medianGap < 20 || medianGap > 60)
                return null;

            var median = StableAmount(recent);
            if (median == null)
                return null;

            return new BillCandidate
            {
                Cadence = "Monthly",
                ExpectedAmount = median.Value,
                DueDayOfMonth = DetectionMath.MedianInt(recent.Select(t => t.TransactionDate.Day).ToList()),
                LastSeenDate = recent.Max(t => t.TransactionDate),
                OccurrenceCount = recent.Count
            };
        }

        // Non-monthly cadences, classified from the median gap between occurrences over the
        // extended window (e.g. weekly SIPs, quarterly insurance, yearly subscriptions).
        private static BillCandidate? TryIntervalCandidate(List<DetectionTxn> occurrences, DateTime today)
        {
            // Same-day duplicates (retries, split charges) would produce zero-length gaps.
            var dates = occurrences.Select(t => t.TransactionDate.Date).Distinct().OrderBy(d => d).ToList();
            if (dates.Count < 2)
                return null;

            var gaps = GapDays(dates);
            var medianGap = DetectionMath.MedianInt(gaps);

            foreach (var (cadence, minGap, maxGap, minOccurrences, intervalDays) in IntervalCadences)
            {
                if (medianGap < minGap || medianGap > maxGap || dates.Count < minOccurrences)
                    continue;

                // The rhythm must be steady: most gaps close to the median.
                var steady = gaps.Count(g => Math.Abs(g - medianGap) <= medianGap * 0.25);
                if (steady < Math.Ceiling(gaps.Count * 0.6))
                    return null;

                // A lapsed subscription (nothing recent) shouldn't be suggested.
                if ((today - dates[^1]).TotalDays > intervalDays * 1.5)
                    return null;

                var median = StableAmount(occurrences);
                if (median == null)
                    return null;

                return new BillCandidate
                {
                    Cadence = cadence,
                    ExpectedAmount = median.Value,
                    DueDayOfMonth = DetectionMath.MedianInt(occurrences.Select(t => t.TransactionDate.Day).ToList()),
                    LastSeenDate = occurrences.Max(t => t.TransactionDate),
                    OccurrenceCount = occurrences.Count
                };
            }

            return null;
        }

        // Typical spacing between occurrences, or null when there aren't two distinct dates.
        private static int? MedianGapDays(List<DetectionTxn> occurrences)
        {
            var dates = occurrences.Select(t => t.TransactionDate.Date).Distinct().OrderBy(d => d).ToList();
            return dates.Count < 2 ? null : DetectionMath.MedianInt(GapDays(dates));
        }

        private static List<int> GapDays(List<DateTime> orderedDates)
        {
            var gaps = new List<int>();
            for (int i = 1; i < orderedDates.Count; i++)
                gaps.Add((orderedDates[i] - orderedDates[i - 1]).Days);
            return gaps;
        }

        // Median amount when most occurrences cluster around it, else null (not a fixed bill).
        private static decimal? StableAmount(List<DetectionTxn> occurrences)
        {
            var amounts = occurrences.Select(t => t.Debit).ToList();
            var median = DetectionMath.Median(amounts);
            var withinTolerance = amounts.Count(a =>
                median == 0m ? a == 0m : Math.Abs(a - median) / median <= AmountTolerance);
            return withinTolerance < Math.Ceiling(amounts.Count * 0.6) ? null : median;
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

            // Monthly bills only need the current + previous month to decide "paid this cycle";
            // interval bills (weekly/quarterly/yearly) anchor their next due date on the last
            // matching payment, so those need a window covering a full year.
            var anyInterval = bills.Any(b => CadenceOf(b) != "Monthly");
            var from = anyInterval
                ? today.AddMonths(-13)
                : new DateTime(today.Year, today.Month, 1).AddMonths(-1);
            var debitsByKey = accountIds.Count == 0
                ? new Dictionary<string, List<DetectionTxn>>(StringComparer.OrdinalIgnoreCase)
                : session.Query<BankTransaction>()
                    .Where(t => accountIds.Contains(t.AccountId) && t.Debit > 0 && t.TransactionDate >= from)
                    .ProjectDetection()
                    .ToList()
                    .GroupBy(t => BuildKey(t).Key, StringComparer.OrdinalIgnoreCase)
                    .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.OrdinalIgnoreCase);

            var views = new List<BillView>();
            foreach (var bill in bills)
            {
                var cadence = CadenceOf(bill);
                debitsByKey.TryGetValue(bill.MatchKey, out var keyMatches);

                DateTime nextDue;
                bool paid;
                if (cadence == "Monthly")
                {
                    nextDue = ProjectDueDate(bill.DueDayOfMonth, today);
                    var billingMonth = nextDue.Year * 12 + nextDue.Month;
                    // Any same-key debit in the billing month counts (no amount filter, so
                    // variable bills like electricity still register as paid).
                    paid = keyMatches?.Any(t =>
                        t.TransactionDate.Year * 12 + t.TransactionDate.Month == billingMonth) ?? false;
                }
                else
                {
                    // Amount-close matches only, so a one-off different-sized charge to the
                    // same merchant doesn't shift the cycle anchor.
                    var lastPaid = keyMatches?
                        .Where(t => IsAmountClose(t.Debit, bill.ExpectedAmount))
                        .Select(t => (DateTime?)t.TransactionDate.Date)
                        .Max();
                    var anchor = lastPaid ?? bill.LastSeenDate?.Date ?? today;
                    nextDue = anchor;
                    while (nextDue < today)
                        nextDue = Advance(nextDue, cadence);
                    // Paid when the payment for the cycle ending at nextDue already posted.
                    paid = lastPaid.HasValue && lastPaid.Value > Retreat(nextDue, cadence);
                }

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
                    Cadence = cadence,
                    LastSeenDate = bill.LastSeenDate,
                    NextDueDate = nextDue,
                    DaysUntilDue = daysUntilDue,
                    PaidThisCycle = paid
                });
            }

            return views.OrderBy(v => v.DaysUntilDue).ToList();
        }

        /// <summary>Effective cadence of a bill; rows from before cadence support are monthly.</summary>
        public static string CadenceOf(RecurringBill bill) =>
            NormalizeCadence(bill.Cadence) ?? "Monthly";

        /// <summary>Maps free-form input to a known cadence value, or null when unrecognized.</summary>
        public static string? NormalizeCadence(string? cadence) => cadence?.Trim().ToLowerInvariant() switch
        {
            "weekly" => "Weekly",
            "monthly" => "Monthly",
            "quarterly" => "Quarterly",
            "yearly" => "Yearly",
            _ => null
        };

        private static DateTime Advance(DateTime date, string cadence) => cadence switch
        {
            "Weekly" => date.AddDays(7),
            "Quarterly" => date.AddMonths(3),
            "Yearly" => date.AddYears(1),
            _ => date.AddMonths(1)
        };

        private static DateTime Retreat(DateTime date, string cadence) => cadence switch
        {
            "Weekly" => date.AddDays(-7),
            "Quarterly" => date.AddMonths(-3),
            "Yearly" => date.AddYears(-1),
            _ => date.AddMonths(-1)
        };

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

            var query = session.Query<BankTransaction>()
                .Where(t => accountIds.Contains(t.AccountId) && t.Debit > 0);

            // A merchant-backed bill's key is "M:{id}", so the key match is expressible in
            // SQL — an index seek on CounterPartyId instead of dragging every debit the user
            // has ever had through BuildKey in memory. Narration-keyed bills ("N:…") still
            // need the in-memory pass, since the key is a normalization of the text.
            var merchantId = bill.CounterParty?.Id;
            if (merchantId != null)
                query = query.Where(t => t.CounterParty != null && t.CounterParty.Id == merchantId.Value);
            else
                // BuildKey yields "M:{id}" for any row with a merchant, so a narration-keyed
                // bill can only ever match merchant-less rows — the rest are dead weight.
                query = query.Where(t => t.CounterParty == null);

            return query
                .ProjectDetection()
                .ToList()
                // Same key AND a similar amount, so one-off payments to the same merchant
                // (a different-sized charge) don't get mixed into this recurring bill.
                .Where(t => BuildKey(t).Key == bill.MatchKey && IsAmountClose(t.Debit, bill.ExpectedAmount))
                .OrderByDescending(t => t.TransactionDate)
                .Select(t => new BillTransaction
                {
                    Date = t.TransactionDate,
                    Amount = t.Debit,
                    Description = t.MerchantDisplay
                        ?? (!string.IsNullOrWhiteSpace(t.Narration) ? t.Narration! : t.Description ?? string.Empty),
                    Mode = t.Mode ?? string.Empty,
                    BankReference = t.BankReference
                })
                .ToList();
        }

        /// <summary>
        /// Confirmed bills with the payments that actually posted within [start, end):
        /// a debit counts toward a bill when its grouping key matches the bill's
        /// <see cref="RecurringBill.MatchKey"/> and the amount is close to the expected amount
        /// (same rule as <see cref="GetMatchingTransactions"/>). Bills with no payments in the
        /// period are omitted.
        /// </summary>
        public List<BillPeriodView> GetPaymentsInPeriod(long userId, DateTime start, DateTime end)
        {
            using var session = DbHelper.GetSession();

            var bills = session.Query<RecurringBill>()
                .Where(b => b.OwnerUserId == userId && b.Status == "Confirmed")
                .ToList();
            if (bills.Count == 0)
                return new List<BillPeriodView>();

            var accountIds = OwnedAccountIds(session, userId);
            if (accountIds.Count == 0)
                return new List<BillPeriodView>();

            var debitsByKey = session.Query<BankTransaction>()
                .Where(t => accountIds.Contains(t.AccountId) && t.Debit > 0
                         && t.TransactionDate >= start && t.TransactionDate < end)
                .ProjectDetection()
                .ToList()
                .GroupBy(t => BuildKey(t).Key, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.OrdinalIgnoreCase);

            var views = new List<BillPeriodView>();
            foreach (var bill in bills)
            {
                if (!debitsByKey.TryGetValue(bill.MatchKey, out var candidates))
                    continue;

                var payments = candidates.Where(t => IsAmountClose(t.Debit, bill.ExpectedAmount)).ToList();
                if (payments.Count == 0)
                    continue;

                views.Add(new BillPeriodView
                {
                    Name = bill.Name,
                    ExpectedAmount = bill.ExpectedAmount,
                    PaidCount = payments.Count,
                    TotalPaid = payments.Sum(t => t.Debit),
                    LastPaidDate = payments.Max(t => t.TransactionDate),
                });
            }

            return views.OrderByDescending(v => v.TotalPaid).ToList();
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
            AccountAccess.OwnedIds(session, userId);

        // A transaction's grouping key: prefer the linked merchant, else a normalized narration.
        private static (string Key, string Display) BuildKey(DetectionTxn t)
        {
            if (t.CounterPartyId != null)
                return ($"M:{t.CounterPartyId}", t.MerchantDisplay!);

            var source = !string.IsNullOrWhiteSpace(t.Narration) ? t.Narration : t.Description;
            var norm = NormalizeNarration(source);
            return ($"N:{norm}", ToTitleCase(norm));
        }

        /// <summary>Grouping key for a manually-added bill, derived from its display name so it
        /// still matches the same normalized-narration transactions detection would have found.</summary>
        public static string BuildManualKey(string name) => "N:" + NormalizeNarration(name);

        private static string NormalizeNarration(string? s)
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
    }

    public class BillCandidate
    {
        public string Name { get; set; } = string.Empty;
        public string MatchKey { get; set; } = string.Empty;
        public int? CounterPartyId { get; set; }
        public decimal ExpectedAmount { get; set; }
        public int DueDayOfMonth { get; set; }
        public string Cadence { get; set; } = "Monthly";
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

    public class BillPeriodView
    {
        public string Name { get; set; } = string.Empty;
        public decimal ExpectedAmount { get; set; }
        public int PaidCount { get; set; }
        public decimal TotalPaid { get; set; }
        public DateTime LastPaidDate { get; set; }
    }

    public class BillView
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public string MatchKey { get; set; } = string.Empty;
        public int? CounterPartyId { get; set; }
        public decimal ExpectedAmount { get; set; }
        public int DueDayOfMonth { get; set; }
        public string Cadence { get; set; } = "Monthly";
        public DateTime? LastSeenDate { get; set; }
        public DateTime NextDueDate { get; set; }
        public int DaysUntilDue { get; set; }
        public bool PaidThisCycle { get; set; }
    }
}
