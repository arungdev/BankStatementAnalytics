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
            [FromQuery] string accountIds = null,
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

                default:
                    return BadRequest("Invalid period. Use 'day', 'week', or 'month'.");
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
            [FromQuery] string accountIds = null,
            [FromQuery] DateTime? startDate = null,
            [FromQuery] DateTime? endDate = null,
            [FromQuery] string kind = null)
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

        private static DateTime GetStartOfWeek(DateTime dt)
        {
            int diff = (7 + (dt.DayOfWeek - DayOfWeek.Sunday)) % 7;
            return dt.AddDays(-diff).Date;
        }
    }
}
