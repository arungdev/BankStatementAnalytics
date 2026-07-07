using Microsoft.AspNetCore.Mvc;
using NHibernate.Linq;
using Common.Framework.Data;
using Common.Framework.Web;
using BankStatementAnalytics.Models;
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
            // Resolve the set of accounts to aggregate: either the comma-separated
            // "All accounts" list or a single accountId. Both are filtered to owned.
            var ownedIds = DbHelper.GetAll<Account>()
                .Where(a => a.OwnerUserId == CurrentUserId)
                .Select(a => a.Id)
                .ToHashSet();

            List<long> ids;
            if (!string.IsNullOrWhiteSpace(accountIds))
            {
                ids = accountIds.Split(',')
                    .Select(s => long.TryParse(s.Trim(), out var id) ? id : 0)
                    .Where(id => id > 0 && ownedIds.Contains(id))
                    .ToList();
            }
            else if (accountId != 0 && ownedIds.Contains(accountId))
            {
                ids = new List<long> { accountId };
            }
            else if (accountId != 0)
            {
                return NotFound();
            }
            else
            {
                return Ok(new List<object>());
            }

            if (!ids.Any())
                return Ok(new List<object>());

            using var session = DbHelper.GetSession();

            var start = startDate.HasValue ? startDate.Value.Date : (DateTime?)null;
            var end = endDate.HasValue ? endDate.Value.Date : (DateTime?)null;

            var query = session.Query<BankTransaction>().Where(t => ids.Contains(t.AccountId));

            if (start.HasValue)
                query = query.Where(t => t.TransactionDate.Date >= start.Value);
            if (end.HasValue)
                query = query.Where(t => t.TransactionDate.Date <= end.Value);

            var all = await query
                .Select(t => new { Date = t.TransactionDate.Date, Spend = t.Debit, Income = t.Credit })
                .ToListAsync();

            if (!all.Any())
                return Ok(new List<object>());

            IEnumerable<object> result;

            switch (period.ToLower())
            {
                case "day":
                    result = all
                        .GroupBy(t => t.Date)
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
