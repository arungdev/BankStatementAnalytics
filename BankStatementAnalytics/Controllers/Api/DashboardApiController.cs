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
    [Route("api/dashboard")]
    public class DashboardApiController : TenantControllerBase
    {
        [HttpGet]
        public async Task<IActionResult> GetDashboardData(
            [FromQuery] int accountId,
            [FromQuery] string accountIds = null)
        {
            using var session = DbHelper.GetSession();

            // Resolve the accounts to aggregate: either the comma-separated
            // "All accounts" list or a single accountId, filtered to owned.
            var ownedIds = AccountAccess.OwnedIdSet(session, CurrentUserId);
            var (status, ids) = AccountAccess.ResolveScope(ownedIds, accountIds, accountId);
            if (status == AccountAccess.ScopeStatus.NotFound)
                return NotFound();
            if (ids.Count == 0)
                return Ok(null); // Frontend handles null data

            var baseQuery = session.Query<BankTransaction>().Where(t => ids.Contains(t.AccountId));

            // Totals computed in SQL rather than by loading every row.
            var totalIncome = await baseQuery.SumAsync(t => (decimal?)t.Credit) ?? 0m;
            var totalSpends = await baseQuery.SumAsync(t => (decimal?)t.Debit) ?? 0m;
            var totalTransactions = await baseQuery.CountAsync();

            // Top spending merchants — grouped server-side.
            var topMerchants = await baseQuery
                .Where(t => t.Debit > 0 && t.CounterParty != null
                         && t.CounterParty.Name != null && t.CounterParty.Name != "")
                .GroupBy(t => t.CounterParty.Name)
                .Select(g => new { name = g.Key, amount = g.Sum(t => t.Debit) })
                .OrderByDescending(x => x.amount)
                .Take(5)
                .ToListAsync();

            // Most recent 5 — only these rows leave the DB.
            var recent = await baseQuery
                .OrderByDescending(t => t.TransactionDate)
                .Take(5)
                .Select(t => new
                {
                    id = t.BankReference,
                    name = t.CounterParty != null ? t.CounterParty.Name : null,
                    date = t.TransactionDate,
                    mode = t.Mode,
                    income = t.Credit,
                    spend = t.Debit
                })
                .ToListAsync();

            var recentTransactions = recent.Select(t => new
            {
                id = t.id,
                name = t.name ?? "N/A",
                date = t.date,
                mode = t.mode,
                amount = t.income > 0 ? t.income : -t.spend // Frontend expects negative for spends
            }).ToList();

            return Ok(new { totalIncome, totalSpends, totalTransactions, topMerchants, recentTransactions });
        }
        [HttpGet("insights")]
        public async Task<IActionResult> GetInsights(
    [FromQuery] string accountIds,
    [FromQuery] DateTime? startDate = null,
    [FromQuery] DateTime? endDate = null)
        {
            if (string.IsNullOrWhiteSpace(accountIds))
                return BadRequest("accountIds is required.");

            using var session = DbHelper.GetSession();

            var ownedIds = AccountAccess.OwnedIdSet(session, CurrentUserId);
            var ids = AccountAccess.FilterOwned(accountIds, ownedIds);

            if (!ids.Any())
                return BadRequest("No valid accountIds provided.");

            var query = session.Query<BankTransaction>()
                .Where(t => ids.Contains(t.AccountId) && t.Debit > 0);

            if (startDate.HasValue)
                query = query.Where(t => (t.EffectiveDate ?? t.TransactionDate) >= startDate.Value.Date);

            if (endDate.HasValue)
                query = query.Where(t => (t.EffectiveDate ?? t.TransactionDate) <= endDate.Value.Date.AddDays(1).AddTicks(-1));

            // Narrow projection: only the five fields the groupings need, not whole entities.
            var rows = await query
                .Select(t => new
                {
                    t.Debit,
                    t.CategoryOverride,
                    MerchantName = t.CounterParty != null ? t.CounterParty.Name : null,
                    MerchantCategory = t.CounterParty != null ? t.CounterParty.Category : null,
                    t.Tags
                })
                .ToListAsync();

            // By Category
            var byCategory = rows
                .GroupBy(t => t.CategoryOverride ?? t.MerchantCategory ?? "Uncategorized")
                .Select(g => new
                {
                    name = g.Key,
                    total = g.Sum(t => t.Debit),
                    count = g.Count()
                })
                .OrderByDescending(x => x.total)
                .ToList();

            // By Merchant
            var byMerchant = rows
                .Where(t => t.MerchantName != null)
                .GroupBy(t => t.MerchantName!)
                .Select(g => new
                {
                    name = g.Key,
                    total = g.Sum(t => t.Debit),
                    count = g.Count()
                })
                .OrderByDescending(x => x.total)
                .Take(20)
                .ToList();

            // By Tag (Tags is a CSV column — must be split in memory)
            var byTag = rows
                .Where(t => !string.IsNullOrWhiteSpace(t.Tags))
                .SelectMany(t => t.Tags!.Split(',')
                    .Select(tag => new { tag = tag.Trim(), t.Debit }))
                .GroupBy(x => x.tag)
                .Select(g => new
                {
                    name = g.Key,
                    total = g.Sum(x => x.Debit),
                    count = g.Count()
                })
                .OrderByDescending(x => x.total)
                .ToList();

            return Ok(new { byCategory, byMerchant, byTag });
        }
        [HttpGet("insights/transactions")]
        public async Task<IActionResult> GetInsightTransactions(
    [FromQuery] string accountIds,
    [FromQuery] string groupBy,
    [FromQuery] string groupValue,
    [FromQuery] DateTime? startDate = null,
    [FromQuery] DateTime? endDate = null)
        {
            if (string.IsNullOrWhiteSpace(accountIds))
                return BadRequest("accountIds is required.");

            using var session = DbHelper.GetSession();

            var ownedIds = AccountAccess.OwnedIdSet(session, CurrentUserId);
            var ids = AccountAccess.FilterOwned(accountIds, ownedIds);

            if (!ids.Any())
                return BadRequest("No valid accountIds provided.");

            IQueryable<BankTransaction> query = session.Query<BankTransaction>()
                .Where(t => ids.Contains(t.AccountId) && t.Debit > 0);

            if (startDate.HasValue)
                query = query.Where(t => (t.EffectiveDate ?? t.TransactionDate) >= startDate.Value.Date);

            if (endDate.HasValue)
                query = query.Where(t => (t.EffectiveDate ?? t.TransactionDate) <= endDate.Value.Date.AddDays(1).AddTicks(-1));

            // Push the merchant/category group filter into SQL; only byTag needs in-memory
            // splitting of the CSV Tags column.
            switch (groupBy)
            {
                case "byMerchant":
                    query = query.Where(t => t.CounterParty != null && t.CounterParty.Name == groupValue);
                    break;

                case "byCategory" when groupValue == "Uncategorized":
                    query = query.Where(t => t.CategoryOverride == null
                        && (t.CounterParty == null || t.CounterParty.Category == null));
                    break;

                case "byCategory":
                    query = query.Where(t => t.CategoryOverride == groupValue
                        || (t.CategoryOverride == null && t.CounterParty != null && t.CounterParty.Category == groupValue));
                    break;

                case "byTag":
                    break; // handled in memory below

                default:
                    return Ok(new List<object>());
            }

            var projected = query
                .OrderByDescending(t => t.TransactionDate)
                .Select(t => new
                {
                    id = t.BankReference,
                    date = t.TransactionDate,
                    description = t.CounterParty != null ? t.CounterParty.Name : t.BankReference,
                    accountId = t.AccountId,
                    amount = t.Debit,
                    tags = t.Tags
                });

            var rows = await projected.ToListAsync();

            IEnumerable<object> result = groupBy == "byTag"
                ? rows.Where(t => !string.IsNullOrWhiteSpace(t.tags)
                        && t.tags.Split(',').Select(tag => tag.Trim()).Contains(groupValue))
                      .Select(t => new { t.id, t.date, t.description, t.accountId, t.amount })
                : rows.Select(t => new { t.id, t.date, t.description, t.accountId, t.amount });

            return Ok(result.ToList());
        }
    }
}
