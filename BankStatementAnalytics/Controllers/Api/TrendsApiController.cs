using Microsoft.AspNetCore.Mvc;
using NHibernate.Linq;
using Common.Framework.Data;
using Common.Framework.Web;
using BankStatementAnalytics.Models;
using BankStatementAnalytics.Services;
using System;
using System.Linq;
using System.Threading.Tasks;
using System.Collections.Generic;

namespace BankStatementAnalytics.Controllers.Api
{
    [ApiController]
    [Route("api/trends")]
    public class TrendsApiController : TenantControllerBase
    {
        [HttpGet]
        public async Task<IActionResult> GetTrends(
            [FromQuery] int accountId,
            [FromQuery] string? accountIds = null,
            [FromQuery] string period = "week",
            [FromQuery] DateTime? startDate = null,
            [FromQuery] DateTime? endDate = null)
        {
            using var session = DbHelper.GetSession();

            // Resolve the set of accounts to aggregate: either the comma-separated
            // "All accounts" list or a single accountId. Both are filtered to owned.
            var ownedIds = AccountAccess.OwnedIdSet(session, CurrentUserId);
            var (status, ids) = AccountAccess.ResolveScope(ownedIds, accountIds, accountId);
            if (status == AccountAccess.ScopeStatus.NotFound)
                return NotFound();
            if (ids.Count == 0)
                return Ok(new List<object>());

            var start = startDate.HasValue ? startDate.Value.Date : (DateTime?)null;
            var end = endDate.HasValue ? endDate.Value.Date : (DateTime?)null;

            var query = session.Query<BankTransaction>()
                .ExcludeOwnMoneyMoves()
                .Where(t => ids.Contains(t.AccountId));

            // Filter on COALESCE(EffectiveDate, TransactionDate) so merchants flagged
            // ShiftToNextMonth land in the right bucket. This sacrifices the
            // IX_BankTransactions_Account_Date index, which is acceptable locally.
            if (start.HasValue)
                query = query.Where(t => (t.EffectiveDate ?? t.TransactionDate) >= start.Value);
            if (end.HasValue)
            {
                var endExclusive = end.Value.AddDays(1);
                query = query.Where(t => (t.EffectiveDate ?? t.TransactionDate) < endExclusive);
            }

            // .Date is applied in memory (in the group keys) rather than in SQL: date-part
            // extraction on a COALESCE expression is a dialect-translation risk.
            var all = await query
                .Select(t => new { Date = t.EffectiveDate ?? t.TransactionDate, Spend = t.Debit, Income = t.Credit })
                .ToListAsync();

            if (!all.Any())
                return Ok(new List<object>());

            IEnumerable<object> result;

            switch (period.ToLower())
            {
                case "day":
                    result = all
                        .GroupBy(t => t.Date.Date)
                        .OrderBy(g => g.Key)
                        .Select(g => new {
                            date = g.Key.ToString("yyyy-MM-dd"),
                            label = g.Key.ToString("dd MMM"),
                            spend = g.Sum(t => t.Spend),
                            income = g.Sum(t => t.Income)
                        });
                    break;

                case "week":
                    result = all
                        .GroupBy(t => GetStartOfWeek(t.Date))
                        .OrderBy(g => g.Key)
                        .Select(g => {
                            var bucketStart = start.HasValue && g.Key < start.Value
                                ? start.Value
                                : g.Key;
                            return new
                            {
                                date = bucketStart.ToString("yyyy-MM-dd"),
                                label = $"W {g.Key:dd/MM}",
                                spend = g.Sum(t => t.Spend),
                                income = g.Sum(t => t.Income)
                            };
                        });
                    break;

                case "month":
                    result = all
                        .GroupBy(t => new DateTime(t.Date.Year, t.Date.Month, 1))
                        .OrderBy(g => g.Key)
                        .Select(g => new {
                            date = g.Key.ToString("yyyy-MM-dd"),
                            label = g.Key.ToString("MMM yy"),
                            spend = g.Sum(t => t.Spend),
                            income = g.Sum(t => t.Income)
                        });
                    break;

                 case "billing_month":
                {
                    // Fetch the account's statement day. Use the first id from the resolved set
                    // when accountId is 0 (e.g. "All accounts" view) as a fallback.
                    var accountIdToUse = accountId != 0 ? accountId : (ids.FirstOrDefault());
                    var account = accountIdToUse != 0 ? DbHelper.GetById<Account>((long)accountIdToUse) : null;
                    int? statementDay = account?.StatementDay;

                    if (statementDay == null)
                    {
                        result = all
                            .GroupBy(t => new DateTime(t.Date.Year, t.Date.Month, 1))
                            .OrderBy(g => g.Key)
                            .Select(g => new {
                                date = g.Key.ToString("yyyy-MM-dd"),
                                label = g.Key.ToString("MMM yy"),
                                spend = g.Sum(t => t.Spend),
                                income = g.Sum(t => t.Income)
                            });
                    }
                    else
                    {
                        result = all
                            .GroupBy(t => GetBillingCycle(t.Date, statementDay.Value))
                            .OrderBy(g => g.Key)
                            .Select(g => new {
                                date = g.Key.ToString("yyyy-MM-dd"),
                                label = g.Key.ToString("MMM yy"),
                                cycleStart = GetCycleStart(g.Key, statementDay.Value).ToString("yyyy-MM-dd"),
                                cycleEnd = GetCycleEnd(g.Key, statementDay.Value).ToString("yyyy-MM-dd"),
                                spend = g.Sum(t => t.Spend),
                                income = g.Sum(t => t.Income)
                            });
                    }
                    break;
                }

                default:
                    return BadRequest("Invalid period. Use 'day', 'week', 'month', or 'billing_month'.");
            }

            return Ok(result);
        }

        // GET: api/trends/transactions?accountIds=1,2&startDate=&endDate=&kind=income|spend|all
        // The rows behind the Trends summary tiles. Same accounts, same effective-date window
        // and the same own-money-move exclusion as GetTrends, so the list always adds up to
        // the tile that was clicked (the per-bar drill-down uses api/statements instead, which
        // shows a single bucket's raw ledger including transfers).
        [HttpGet("transactions")]
        public async Task<IActionResult> GetTrendTransactions(
            [FromQuery] int accountId,
            [FromQuery] string? accountIds = null,
            [FromQuery] DateTime? startDate = null,
            [FromQuery] DateTime? endDate = null,
            [FromQuery] string? kind = null)
        {
            using var session = DbHelper.GetSession();

            var ownedIds = AccountAccess.OwnedIdSet(session, CurrentUserId);
            var (status, ids) = AccountAccess.ResolveScope(ownedIds, accountIds, accountId);
            if (status == AccountAccess.ScopeStatus.NotFound)
                return NotFound();
            if (ids.Count == 0)
                return Ok(new List<object>());

            var query = session.Query<BankTransaction>()
                .ExcludeOwnMoneyMoves()
                .Where(t => ids.Contains(t.AccountId));

            if (startDate.HasValue)
            {
                var start = startDate.Value.Date;
                query = query.Where(t => (t.EffectiveDate ?? t.TransactionDate) >= start);
            }
            if (endDate.HasValue)
            {
                var endExclusive = endDate.Value.Date.AddDays(1);
                query = query.Where(t => (t.EffectiveDate ?? t.TransactionDate) < endExclusive);
            }

            query = kind?.ToLowerInvariant() switch
            {
                "income" => query.Where(t => t.Credit > 0),
                "spend" => query.Where(t => t.Debit > 0),
                _ => query,
            };

            var rows = await query
                .OrderByDescending(t => t.EffectiveDate ?? t.TransactionDate)
                .Select(t => new
                {
                    id = t.BankReference,
                    date = t.EffectiveDate ?? t.TransactionDate,
                    accountId = t.AccountId,
                    description = t.Description,
                    merchant = t.CounterParty != null ? t.CounterParty.Name : null,
                    category = t.CategoryOverride ?? (t.CounterParty != null ? t.CounterParty.Category : null),
                    debit = t.Debit,
                    credit = t.Credit,
                })
                .ToListAsync();

            return Ok(rows);
        }

        // GET: api/trends/daily-spend?year=2026 — daily spending aggregation for spending heatmap calendar
        [HttpGet("daily-spend")]
        public async Task<IActionResult> GetDailySpend(
            [FromQuery] int accountId,
            [FromQuery] string? accountIds = null,
            [FromQuery] int? year = null)
        {
            using var session = DbHelper.GetSession();

            var ownedIds = AccountAccess.OwnedIdSet(session, CurrentUserId);
            var (status, ids) = AccountAccess.ResolveScope(ownedIds, accountIds, accountId);
            if (status == AccountAccess.ScopeStatus.NotFound)
                return NotFound();
            if (ids.Count == 0)
                return Ok(new List<object>());

            var targetYear = year ?? DateTime.Today.Year;
            var start = new DateTime(targetYear, 1, 1);
            var endExclusive = start.AddYears(1);

            var query = session.Query<BankTransaction>()
                .ExcludeOwnMoneyMoves()
                .Where(t => ids.Contains(t.AccountId) && t.Debit > 0);

            query = query.Where(t => (t.EffectiveDate ?? t.TransactionDate) >= start && (t.EffectiveDate ?? t.TransactionDate) < endExclusive);

            var rows = await query
                .Select(t => new
                {
                    Date = t.EffectiveDate ?? t.TransactionDate,
                    Debit = t.Debit
                })
                .ToListAsync();

            var result = rows
                .GroupBy(t => t.Date.Date)
                .OrderBy(g => g.Key)
                .Select(g => new
                {
                    date = g.Key.ToString("yyyy-MM-dd"),
                    totalDebit = g.Sum(x => x.Debit),
                    count = g.Count()
                })
                .ToList();

            return Ok(result);
        }

        private static DateTime GetStartOfWeek(DateTime dt)
        {
            int diff = (7 + (dt.DayOfWeek - DayOfWeek.Sunday)) % 7;
            return dt.AddDays(-diff).Date;
        }

        private static DateTime GetBillingCycle(DateTime date, int statementDay)
        {
            int effectiveDay = Math.Min(statementDay, DateTime.DaysInMonth(date.Year, date.Month));
            if (date.Day <= effectiveDay)
                return new DateTime(date.Year, date.Month, 1);
            var nextMonth = new DateTime(date.Year, date.Month, 1).AddMonths(1);
            return new DateTime(nextMonth.Year, nextMonth.Month, 1);
        }

        private static DateTime GetCycleEnd(DateTime cycleStart, int statementDay)
        {
            int effectiveDay = Math.Min(statementDay, DateTime.DaysInMonth(cycleStart.Year, cycleStart.Month));
            return new DateTime(cycleStart.Year, cycleStart.Month, effectiveDay);
        }

        /// <summary>
        /// Returns the first day of the billing cycle that is labelled by <paramref name="cycleStart"/>.
        /// For a cycle key of 2026-03-01 with statementDay 23, this returns 2026-02-24
        /// (the day after the previous month's statement day).
        /// </summary>
        private static DateTime GetCycleStart(DateTime cycleStart, int statementDay)
        {
            var prevMonth = cycleStart.AddMonths(-1);
            int effectiveDay = Math.Min(statementDay, DateTime.DaysInMonth(prevMonth.Year, prevMonth.Month));
            return new DateTime(prevMonth.Year, prevMonth.Month, effectiveDay).AddDays(1);
        }
    }
}
