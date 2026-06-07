using Microsoft.AspNetCore.Mvc;
using NHibernate.Linq;
using Common.Framework.Data;
using BankStatementAnalytics.Models;
using System;
using System.Linq;
using System.Threading.Tasks;
using Common.Framework.Logging;
using System.Collections.Generic;

namespace BankStatementAnalytics.Controllers.Api
{
    [ApiController]
    [Route("api/trends")]
    public class TrendsApiController : ControllerBase
    {
        [HttpGet]
        public async Task<IActionResult> GetTrends(
            [FromQuery] int accountId,
            [FromQuery] string period = "week",
            [FromQuery] DateTime? startDate = null,
            [FromQuery] DateTime? endDate = null)
        {
            if (accountId == 0)
                return Ok(new List<object>());

            try
            {
                using var session = DbHelper.GetSession();

                // Normalise to date-only boundaries so timezone-shifted strings
                // from the frontend ("2026-05-01") always compare correctly.
                var start = startDate.HasValue ? startDate.Value.Date : (DateTime?)null;
                var end = endDate.HasValue ? endDate.Value.Date : (DateTime?)null;

                var hdfcQuery = session.Query<HdfcTransaction>().Where(t => t.AccountId == accountId);
                var iobQuery = session.Query<IobTransaction>().Where(t => t.AccountId == accountId);

                if (start.HasValue)
                {
                    hdfcQuery = hdfcQuery.Where(t => t.TransactionDate.Date >= start.Value);
                    iobQuery = iobQuery.Where(t => t.TransactionDate.Date >= start.Value);
                }
                if (end.HasValue)
                {
                    hdfcQuery = hdfcQuery.Where(t => t.TransactionDate.Date <= end.Value);
                    iobQuery = iobQuery.Where(t => t.TransactionDate.Date <= end.Value);
                }

                var hdfcTransactions = await hdfcQuery
                    .Select(t => new { t.TransactionDate, t.Debit, t.Credit })
                    .ToListAsync();

                var iobTransactions = await iobQuery
                    .Select(t => new { t.TransactionDate, t.Debit, t.Credit })
                    .ToListAsync();

                var all = hdfcTransactions
                    .Select(t => new { Date = t.TransactionDate.Date, Spend = t.Debit, Income = t.Credit })
                    .Concat(iobTransactions
                    .Select(t => new { Date = t.TransactionDate.Date, Spend = t.Debit, Income = t.Credit }))
                    .ToList();

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
                                // ↓ ISO date lets the frontend filter/sort reliably
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
                                // The week bucket key can be before startDate (e.g. Apr 30
                                // for a week containing May 1). Use the later of the two
                                // so the label/date always falls within the requested range.
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
            catch (Exception ex)
            {
                Log.Exception(ex);
                return StatusCode(500, "Internal server error while fetching trends.");
            }
        }

        private static DateTime GetStartOfWeek(DateTime dt)
        {
            int diff = (7 + (dt.DayOfWeek - DayOfWeek.Sunday)) % 7;
            return dt.AddDays(-diff).Date;
        }
    }
}