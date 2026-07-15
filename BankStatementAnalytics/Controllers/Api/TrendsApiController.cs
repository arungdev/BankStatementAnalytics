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

            var query = session.Query<BankTransaction>().Where(t => ids.Contains(t.AccountId));

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

        private static DateTime GetStartOfWeek(DateTime dt)
        {
            int diff = (7 + (dt.DayOfWeek - DayOfWeek.Sunday)) % 7;
            return dt.AddDays(-diff).Date;
        }
    }
}
