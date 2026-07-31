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

            // TRANSFER rows (credit-card bill payments etc.) are the user's own
            // money moving between accounts — excluded from income/spend so they
            // don't inflate both sides. Null-safe: SQL NULL != 'TRANSFER' drops rows.
            var analyticsQuery = baseQuery.ExcludeOwnMoneyMoves();

            // Totals computed in SQL rather than by loading every row.
            var totalIncome = await analyticsQuery.SumAsync(t => (decimal?)t.Credit) ?? 0m;
            var totalSpends = await analyticsQuery.SumAsync(t => (decimal?)t.Debit) ?? 0m;
            var totalTransactions = await baseQuery.CountAsync();

            // Top spending merchants — grouped server-side.
            var topMerchants = await analyticsQuery
                .Where(t => t.Debit > 0 && t.CounterParty != null
                         && t.CounterParty.Name != null && t.CounterParty.Name != "")
                .GroupBy(t => t.CounterParty.Name)
                .Select(g => new { name = g.Key, amount = g.Sum(t => t.Debit) })
                .OrderByDescending(x => x.amount)
                .Take(5)
                .ToListAsync();

            // First page of the activity feed — the rest is paged in by
            // api/dashboard/recent as the user scrolls. One extra row is fetched
            // purely to answer "is there more?" without a second COUNT.
            var recent = await RecentPageQuery(baseQuery, 0, RecentPageSize + 1).ToListAsync();
            var recentHasMore = recent.Count > RecentPageSize;
            var recentTransactions = recent.Take(RecentPageSize).Select(ToFeedItem).ToList();

            return Ok(new { totalIncome, totalSpends, totalTransactions, topMerchants, recentTransactions, recentHasMore });
        }

        // GET: api/dashboard/recent — pages the Overview activity feed past the
        // first batch the dashboard payload already carries.
        [HttpGet("recent")]
        public async Task<IActionResult> GetRecentActivity(
            [FromQuery] int accountId,
            [FromQuery] string accountIds = null,
            [FromQuery] int skip = 0,
            [FromQuery] int take = RecentPageSize)
        {
            using var session = DbHelper.GetSession();

            var ownedIds = AccountAccess.OwnedIdSet(session, CurrentUserId);
            var (status, ids) = AccountAccess.ResolveScope(ownedIds, accountIds, accountId);
            if (status == AccountAccess.ScopeStatus.NotFound)
                return NotFound();
            if (ids.Count == 0)
                return Ok(new { items = new List<object>(), hasMore = false });

            skip = Math.Max(skip, 0);
            take = Math.Clamp(take, 1, 50);

            var baseQuery = session.Query<BankTransaction>().Where(t => ids.Contains(t.AccountId));
            var rows = await RecentPageQuery(baseQuery, skip, take + 1).ToListAsync();

            return Ok(new
            {
                items = rows.Take(take).Select(ToFeedItem).ToList(),
                hasMore = rows.Count > take
            });
        }

        private const int RecentPageSize = 10;

        // Columns the activity feed actually renders — projected in SQL so the
        // full entity (and a lazy CounterParty load per row) never leaves the DB.
        private sealed class RecentRow
        {
            public string Id { get; set; }
            public string Name { get; set; }
            public DateTime Date { get; set; }
            public string Mode { get; set; }
            public decimal Income { get; set; }
            public decimal Spend { get; set; }
        }

        private static IQueryable<RecentRow> RecentPageQuery(IQueryable<BankTransaction> query, int skip, int take) =>
            query
                .OrderByDescending(t => t.TransactionDate)
                // Same-day ties are the norm, and an unstable sort makes paged
                // windows overlap or skip rows. BankReference + AccountId is the
                // rest of the row identity, so this ordering is total.
                .ThenByDescending(t => t.BankReference)
                .ThenBy(t => t.AccountId)
                .Skip(skip)
                .Take(take)
                .Select(t => new RecentRow
                {
                    Id = t.BankReference,
                    Name = t.CounterParty != null ? t.CounterParty.Name : null,
                    Date = t.TransactionDate,
                    Mode = t.Mode,
                    Income = t.Credit,
                    Spend = t.Debit
                });

        private static object ToFeedItem(RecentRow r) => new
        {
            id = r.Id,
            name = r.Name ?? "N/A",
            date = r.Date,
            mode = r.Mode,
            amount = r.Income > 0 ? r.Income : -r.Spend // Frontend expects negative for spends
        };

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
                .ExcludeOwnMoneyMoves() // own-money moves aren't spend
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
    // Optional: groupBy=all spans every group, so it carries no value to match on.
    [FromQuery] string groupValue = null,
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
                .ExcludeOwnMoneyMoves() // mirror the insights filter
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

                // Every spend in the range, ungrouped — backs the "Total Spent" tile,
                // whose denominator is the whole chart rather than one slice.
                case "all":
                    break;

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
