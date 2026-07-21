using BankStatementAnalytics.EnumClass;
using BankStatementAnalytics.Models;
using Common.Framework.Data;
using Common.Framework.Web;
using Microsoft.AspNetCore.Mvc;
using System;
using System.Collections.Generic;
using System.Linq;

namespace BankStatementAnalytics.Controllers.Api
{
    /// <summary>
    /// Credit-card-only endpoints: the parsed statement summary, credit
    /// utilization, billing-cycle spend, manual card settings, and due-date
    /// reminders. All routes 404 for non-credit-card accounts so the features
    /// stay exclusive to cards.
    /// </summary>
    [ApiController]
    [Route("api/cards")]
    public class CardApiController : TenantControllerBase
    {
        // GET: api/cards/{accountId}/summary
        [HttpGet("{accountId}/summary")]
        public IActionResult GetSummary(int accountId)
        {
            var account = DbHelper.GetById<Account>((long)accountId);
            if (!Owns(account) || account.BankName != Bank.HDFCCreditCard)
                return NotFound();

            using var session = DbHelper.GetSession();

            var summary = LatestSummary(session, accountId);
            var txns = LoadCardTransactions(session, accountId, account.BankName);

            var outstanding = OutstandingFor(txns, summary);
            var creditLimit = summary?.CreditLimit ?? account.CreditLimit;
            var today = DateTime.Today;

            // HDFC add-on/second cards draw on one shared limit: utilization and
            // available credit must count every card in the group, not just this one.
            var group = SharedLimitGroup(session, account);
            var groupOutstanding = outstanding;
            List<object>? sharedCards = null;
            if (group.Count > 1)
            {
                sharedCards = new List<object>();
                foreach (var member in group)
                {
                    decimal memberOutstanding;
                    if (member.Id == account.Id)
                    {
                        memberOutstanding = outstanding;
                    }
                    else
                    {
                        var mSummary = LatestSummary(session, (int)member.Id);
                        memberOutstanding = OutstandingFor(
                            LoadCardTransactions(session, (int)member.Id, member.BankName), mSummary);
                        groupOutstanding += memberOutstanding;
                        creditLimit ??= mSummary?.CreditLimit ?? member.CreditLimit;
                    }
                    sharedCards.Add(new
                    {
                        AccountId = member.Id,
                        member.MaskedAccountNumber,
                        Outstanding = memberOutstanding,
                    });
                }
            }

            // Paid = the user's own money arrived (TRANSFER credit) after the
            // statement was generated, covering at least the minimum due.
            bool? paid = summary?.StatementDate == null
                ? null
                : txns.Any(t => t.Mode == "TRANSFER" && t.Credit > 0
                             && t.TransactionDate > summary.StatementDate.Value
                             && t.Credit >= (summary.MinimumDue ?? 0m));

            var statementDay = summary?.StatementDate?.Day ?? account.StatementDay;
            var (cycleStart, cycleEnd) = CurrentCycle(statementDay, today);
            var spendSoFar = txns
                .Where(t => t.Mode != "TRANSFER"
                         && t.TransactionDate.Date >= cycleStart && t.TransactionDate.Date <= cycleEnd)
                .Sum(t => t.Debit);

            return Ok(new
            {
                AccountId = account.Id,
                account.MaskedAccountNumber,
                Statement = summary == null ? null : new
                {
                    summary.StatementDate,
                    summary.PeriodStart,
                    summary.PeriodEnd,
                    summary.PaymentDueDate,
                    summary.TotalDue,
                    summary.MinimumDue,
                    summary.RewardPointsBalance,
                    DaysUntilDue = summary.PaymentDueDate == null
                        ? (int?)null
                        : (summary.PaymentDueDate.Value.Date - today).Days,
                    Paid = paid,
                },
                Outstanding = outstanding,
                CreditLimit = creditLimit,
                // For a shared group the statement's available-limit snapshot only
                // covers one card, so compute it from the combined outstanding.
                AvailableCredit = sharedCards != null
                    ? (creditLimit != null ? Math.Max(0, creditLimit.Value - groupOutstanding) : (decimal?)null)
                    : summary?.AvailableCreditLimit
                        ?? (creditLimit != null ? Math.Max(0, creditLimit.Value - outstanding) : (decimal?)null),
                Utilization = creditLimit > 0
                    ? Math.Round(Math.Max(0, groupOutstanding) / creditLimit.Value, 4)
                    : (decimal?)null,
                SharedLimit = sharedCards == null ? null : new
                {
                    Outstanding = groupOutstanding,
                    Cards = sharedCards,
                },
                StatementDay = statementDay,
                CurrentCycle = new
                {
                    Start = cycleStart,
                    End = cycleEnd,
                    SpendSoFar = spendSoFar,
                    DaysLeft = Math.Max(0, (cycleEnd - today).Days),
                },
            });
        }

        // GET: api/cards/{accountId}/cycles?count=6 — spend per billing cycle,
        // oldest first, ending with the (partial) current cycle.
        [HttpGet("{accountId}/cycles")]
        public IActionResult GetCycles(int accountId, [FromQuery] int count = 6)
        {
            var account = DbHelper.GetById<Account>((long)accountId);
            if (!Owns(account) || account.BankName != Bank.HDFCCreditCard)
                return NotFound();

            count = Math.Clamp(count, 1, 24);

            using var session = DbHelper.GetSession();

            var summary = LatestSummary(session, accountId);
            var statementDay = summary?.StatementDate?.Day ?? account.StatementDay;
            var txns = LoadCardTransactions(session, accountId, account.BankName);

            var today = DateTime.Today;
            var (currentStart, currentEnd) = CurrentCycle(statementDay, today);

            var cycles = new List<object>();
            var end = currentEnd;
            var start = currentStart;
            for (int i = 0; i < count; i++)
            {
                var s = start; // avoid modified-closure on the loop variables
                var e = end;
                var inCycle = txns.Where(t => t.TransactionDate.Date >= s && t.TransactionDate.Date <= e).ToList();

                cycles.Add(new
                {
                    Label = e.ToString("MMM yyyy", System.Globalization.CultureInfo.InvariantCulture),
                    Start = s,
                    End = e,
                    Spend = inCycle.Where(t => t.Mode != "TRANSFER").Sum(t => t.Debit),
                    Credits = inCycle.Where(t => t.Mode != "TRANSFER").Sum(t => t.Credit),
                    IsCurrent = i == 0,
                });

                end = start.AddDays(-1);
                // `end` now sits ON a statement-day boundary, so look strictly
                // before it for the previous one, or the next cycle would be empty.
                start = statementDay == null
                    ? new DateTime(end.Year, end.Month, 1)
                    : PreviousBoundary(end.AddDays(-1), statementDay.Value).AddDays(1);
            }

            cycles.Reverse();
            return Ok(cycles);
        }

        // PUT: api/cards/{accountId}/settings — manual fallback for credit limit /
        // statement day when no parsed statement carries them.
        public class CardSettingsRequest
        {
            public decimal? CreditLimit { get; set; }
            public int? StatementDay { get; set; }
            // Another credit card of the same user whose limit this card shares
            // (HDFC add-on/second card); null = the card has its own limit.
            public long? SharedLimitAccountId { get; set; }
        }

        [HttpPut("{accountId}/settings")]
        public async System.Threading.Tasks.Task<IActionResult> UpdateSettings(int accountId, [FromBody] CardSettingsRequest request)
        {
            var account = DbHelper.GetById<Account>((long)accountId);
            if (!Owns(account) || account.BankName != Bank.HDFCCreditCard)
                return NotFound();

            if (request.StatementDay is < 1 or > 31)
                return BadRequest("Statement day must be between 1 and 31.");
            if (request.CreditLimit is < 0)
                return BadRequest("Credit limit cannot be negative.");

            if (request.SharedLimitAccountId != null)
            {
                if (request.SharedLimitAccountId == account.Id)
                    return BadRequest("A card cannot share its own limit.");

                var target = DbHelper.GetById<Account>(request.SharedLimitAccountId.Value);
                if (!Owns(target) || target.BankName != Bank.HDFCCreditCard)
                    return BadRequest("The linked card must be one of your credit card accounts.");

                // Groups stay one level deep: linking to a card that itself shares
                // another card's limit joins that card's group instead.
                if (target.SharedLimitAccountId != null)
                {
                    if (target.SharedLimitAccountId == account.Id)
                        return BadRequest("That card already shares this card's limit.");
                    request.SharedLimitAccountId = target.SharedLimitAccountId;
                }
            }

            // Re-pointing a card that others share with would orphan their links.
            using (var session = DbHelper.GetSession())
            {
                var hasDependents = session.Query<Account>()
                    .Any(a => a.SharedLimitAccountId == account.Id);
                if (hasDependents && request.SharedLimitAccountId != null)
                    return BadRequest("Other cards share this card's limit — unlink them first.");
            }

            account.CreditLimit = request.CreditLimit;
            account.StatementDay = request.StatementDay;
            account.SharedLimitAccountId = request.SharedLimitAccountId;
            await DbHelper.UpdateAsync(account);

            return Ok(new { account.Id, account.CreditLimit, account.StatementDay, account.SharedLimitAccountId });
        }

        // GET: api/cards/upcoming?withinDays=7 — unpaid card bills due within the
        // window (or overdue), shaped like /api/bills/upcoming for the reminder bell.
        [HttpGet("upcoming")]
        public IActionResult GetUpcoming([FromQuery] int withinDays = 7)
        {
            using var session = DbHelper.GetSession();

            var cardAccounts = session.Query<Account>()
                .Where(a => a.OwnerUserId == CurrentUserId && a.BankName == Bank.HDFCCreditCard)
                .ToList();

            var today = DateTime.Today;
            var reminders = new List<CardReminder>();

            foreach (var account in cardAccounts)
            {
                var summary = LatestSummary(session, (int)account.Id);
                if (summary?.PaymentDueDate == null || summary.TotalDue == null || summary.TotalDue == 0)
                    continue;

                var daysUntilDue = (summary.PaymentDueDate.Value.Date - today).Days;
                if (daysUntilDue > withinDays)
                    continue;

                if (summary.StatementDate != null)
                {
                    var txns = LoadCardTransactions(session, (int)account.Id, account.BankName);
                    bool paid = txns.Any(t => t.Mode == "TRANSFER" && t.Credit > 0
                                           && t.TransactionDate > summary.StatementDate.Value
                                           && t.Credit >= (summary.MinimumDue ?? 0m));
                    if (paid)
                        continue;
                }

                var number = account.MaskedAccountNumber;
                var last4 = number.Length >= 4 ? number[^4..] : number;
                reminders.Add(new CardReminder
                {
                    Id = $"cc-{account.Id}",
                    Name = $"Credit card bill •••• {last4}",
                    NextDueDate = summary.PaymentDueDate.Value,
                    DaysUntilDue = daysUntilDue,
                    ExpectedAmount = summary.TotalDue.Value,
                });
            }

            return Ok(reminders.OrderBy(r => r.DaysUntilDue).ToList());
        }

        // ── Helpers ──────────────────────────────────────────────────────

        public class CardReminder
        {
            public string Id { get; set; } = string.Empty;
            public string Name { get; set; } = string.Empty;
            public DateTime NextDueDate { get; set; }
            public int DaysUntilDue { get; set; }
            public decimal ExpectedAmount { get; set; }
        }

        private sealed class CardTxn
        {
            public DateTime TransactionDate { get; set; }
            public decimal Debit { get; set; }
            public decimal Credit { get; set; }
            public string? Mode { get; set; }
        }

        private static List<CardTxn> LoadCardTransactions(NHibernate.ISession session, int accountId, Bank bank)
        {
            var bankType = BankTypeCode.For(bank);
            return session.Query<BankTransaction>()
                .Where(t => t.AccountId == accountId && t.BankType == bankType)
                .Select(t => new CardTxn
                {
                    TransactionDate = t.TransactionDate,
                    Debit = t.Debit,
                    Credit = t.Credit,
                    Mode = t.Mode,
                })
                .ToList();
        }

        /// <summary>
        /// Anchor the outstanding on the latest statement's billed total plus
        /// everything since — the raw Σ(Debit−Credit) goes negative whenever
        /// history before the first uploaded statement is missing.
        /// </summary>
        private static decimal OutstandingFor(List<CardTxn> txns, CardStatementSummary? summary) =>
            summary?.StatementDate != null && summary.TotalDue != null
                ? summary.TotalDue.Value + txns
                    .Where(t => t.TransactionDate > summary.StatementDate.Value)
                    .Sum(t => t.Debit - t.Credit)
                : txns.Sum(t => t.Debit - t.Credit);

        /// <summary>
        /// Every card drawing on the same limit as <paramref name="account"/> —
        /// the primary card plus all cards linked to it via SharedLimitAccountId.
        /// A card with no links returns just itself.
        /// </summary>
        private List<Account> SharedLimitGroup(NHibernate.ISession session, Account account)
        {
            var rootId = account.SharedLimitAccountId ?? account.Id;
            return session.Query<Account>()
                .Where(a => a.OwnerUserId == CurrentUserId && a.BankName == Bank.HDFCCreditCard
                         && (a.Id == rootId || a.SharedLimitAccountId == rootId))
                .ToList();
        }

        private static CardStatementSummary? LatestSummary(NHibernate.ISession session, int accountId) =>
            session.Query<CardStatementSummary>()
                .Where(s => s.AccountId == accountId)
                .ToList()
                .OrderByDescending(s => s.StatementDate ?? DateTime.MinValue)
                .ThenByDescending(s => s.CreatedAt)
                .FirstOrDefault();

        private static DateTime ClampDay(int year, int month, int day) =>
            new(year, month, Math.Min(day, DateTime.DaysInMonth(year, month)));

        /// <summary>Most recent statement-day boundary on or before <paramref name="date"/>.</summary>
        private static DateTime PreviousBoundary(DateTime date, int statementDay)
        {
            var candidate = ClampDay(date.Year, date.Month, statementDay);
            if (candidate <= date) return candidate;
            var prev = new DateTime(date.Year, date.Month, 1).AddMonths(-1);
            return ClampDay(prev.Year, prev.Month, statementDay);
        }

        /// <summary>
        /// The billing cycle containing today: (last statement day + 1) through the
        /// next statement day. Falls back to the calendar month when no statement
        /// day is known from a parsed statement or manual settings.
        /// </summary>
        private static (DateTime start, DateTime end) CurrentCycle(int? statementDay, DateTime today)
        {
            if (statementDay == null)
            {
                var monthStart = new DateTime(today.Year, today.Month, 1);
                return (monthStart, monthStart.AddMonths(1).AddDays(-1));
            }

            var lastBoundary = PreviousBoundary(today, statementDay.Value);
            var nextMonth = new DateTime(lastBoundary.Year, lastBoundary.Month, 1).AddMonths(1);
            var nextBoundary = ClampDay(nextMonth.Year, nextMonth.Month, statementDay.Value);
            return (lastBoundary.AddDays(1), nextBoundary);
        }
    }
}
