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
            [FromQuery] string? accountIds = null)
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
                .GroupBy(t => t.CounterParty!.Name)
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
            [FromQuery] string? accountIds = null,
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

        // GET: api/dashboard/transactions — the rows behind an Overview summary tile,
        // for the page's drill-down drawer. Filtered exactly like GetDashboardData's
        // totals so the list reconciles with the tile that was clicked: the money tiles
        // drop own-money moves, while "all" counts every row like the Transactions tile.
        // Paged, because the Overview scope is the account's whole history.
        [HttpGet("transactions")]
        public async Task<IActionResult> GetTileTransactions(
            [FromQuery] int accountId,
            [FromQuery] string? accountIds = null,
            [FromQuery] string? kind = null,
            [FromQuery] int skip = 0,
            [FromQuery] int take = TilePageSize)
        {
            using var session = DbHelper.GetSession();

            var ownedIds = AccountAccess.OwnedIdSet(session, CurrentUserId);
            var (status, ids) = AccountAccess.ResolveScope(ownedIds, accountIds, accountId);
            if (status == AccountAccess.ScopeStatus.NotFound)
                return NotFound();
            if (ids.Count == 0)
                return Ok(new { items = new List<object>(), hasMore = false, total = 0, credits = 0m, debits = 0m });

            skip = Math.Max(skip, 0);
            take = Math.Clamp(take, 1, 100);
            kind = kind?.ToLowerInvariant();

            var baseQuery = session.Query<BankTransaction>().Where(t => ids.Contains(t.AccountId));

            var query = kind == "all" ? baseQuery : baseQuery.ExcludeOwnMoneyMoves();
            query = kind switch
            {
                "income" => query.Where(t => t.Credit > 0),
                "spend" => query.Where(t => t.Debit > 0),
                _ => query, // "net"/"all" — both sides of the ledger
            };

            // Footer stats describe the whole filtered set, not just the loaded page,
            // so they still add up to the tile once paging kicks in.
            var total = await query.CountAsync();
            var credits = await query.SumAsync(t => (decimal?)t.Credit) ?? 0m;
            var debits = await query.SumAsync(t => (decimal?)t.Debit) ?? 0m;

            var rows = await query
                .OrderByDescending(t => t.EffectiveDate ?? t.TransactionDate)
                // Same-day ties are the norm, and an unstable sort makes paged windows
                // overlap or skip rows — BankReference + AccountId completes the ordering.
                .ThenByDescending(t => t.BankReference)
                .ThenBy(t => t.AccountId)
                .Skip(skip)
                .Take(take + 1) // one extra row answers "is there more?" without a second COUNT
                .Select(t => new
                {
                    id = t.BankReference,
                    date = t.EffectiveDate ?? t.TransactionDate,
                    accountId = t.AccountId,
                    description = t.Description,
                    merchant = t.CounterParty != null ? t.CounterParty.Name : null,
                    category = t.CategoryOverride ?? (t.CounterParty != null ? t.CounterParty.Category : null),
                    credit = t.Credit,
                    debit = t.Debit
                })
                .ToListAsync();

            return Ok(new
            {
                items = rows.Take(take).ToList(),
                hasMore = rows.Count > take,
                total,
                credits,
                debits
            });
        }

        private const int RecentPageSize = 10;
        private const int TilePageSize = 50;

        // Columns the activity feed actually renders — projected in SQL so the
        // full entity (and a lazy CounterParty load per row) never leaves the DB.
        private sealed class RecentRow
        {
            public string Id { get; set; } = string.Empty;
            public string? Name { get; set; }
            public DateTime Date { get; set; }
            public string? Mode { get; set; }
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

            // Narrow projection: only the fields the groupings need, not whole entities.
            var rows = await query
                .Select(t => new
                {
                    t.AccountId,
                    t.BankReference,
                    t.BankType,
                    t.Debit,
                    t.CategoryOverride,
                    t.SubCategoryOverride,
                    MerchantName = t.CounterParty != null ? t.CounterParty.Name : null,
                    MerchantCategory = t.CounterParty != null ? t.CounterParty.Category : null,
                    t.Tags,
                    t.OriginalCurrency,
                    t.OriginalAmount
                })
                .ToListAsync();

            var splitsLookup = await TransactionSplitHelper.GetSplitsLookupAsync(session, ids);

            var expandedRows = rows
                .SelectMany(t => TransactionSplitHelper.ExpandSpend(
                    t.AccountId,
                    t.BankReference,
                    t.BankType,
                    t.Debit,
                    t.CategoryOverride ?? t.MerchantCategory ?? "Uncategorized",
                    t.SubCategoryOverride,
                    splitsLookup))
                .ToList();

            // By Category
            var byCategory = expandedRows
                .GroupBy(t => t.Category)
                .Select(g => new
                {
                    name = g.Key,
                    total = g.Sum(t => t.Amount),
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

            // By Forex Currency
            var byForex = rows
                .Where(t => !string.IsNullOrWhiteSpace(t.OriginalCurrency))
                .GroupBy(t => t.OriginalCurrency!)
                .Select(g => new
                {
                    name = g.Key,
                    total = g.Sum(t => t.Debit),
                    foreignTotal = g.Sum(t => t.OriginalAmount ?? 0),
                    count = g.Count()
                })
                .OrderByDescending(x => x.total)
                .ToList();

            return Ok(new { byCategory, byMerchant, byTag, byForex });
        }

        // GET: api/dashboard/insights/transactions — the rows behind a chart slice in Insights,
        // for the drill-down drawer. Filtered to the same accounts, date window and own-money-move
        // exclusion as GetInsights. groupBy is "byMerchant" | "byCategory" | "byTag" | "byForex" | "all";
        // groupValue is the slice label (e.g. "Swiggy", "Groceries", "#groceries", "USD").
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
                .ExcludeOwnMoneyMoves() // mirror the insights filter
                .Where(t => ids.Contains(t.AccountId) && t.Debit > 0);

            if (startDate.HasValue)
                query = query.Where(t => (t.EffectiveDate ?? t.TransactionDate) >= startDate.Value.Date);

            if (endDate.HasValue)
                query = query.Where(t => (t.EffectiveDate ?? t.TransactionDate) <= endDate.Value.Date.AddDays(1).AddTicks(-1));

            var isCategory = groupBy == "byCategory";
            if (!isCategory)
            {
                switch (groupBy)
                {
                    case "byMerchant":
                        query = query.Where(t => t.CounterParty != null && t.CounterParty.Name == groupValue);
                        break;

                    case "byTag":
                        break; // handled in memory below

                    case "byForex":
                        query = query.Where(t => t.OriginalCurrency == groupValue);
                        break;

                    case "all":
                        break;

                    default:
                        return Ok(new List<object>());
                }
            }

            var projected = query
                .OrderByDescending(t => t.TransactionDate)
                .Select(t => new
                {
                    id = t.BankReference,
                    bankType = t.BankType,
                    date = t.TransactionDate,
                    description = t.CounterParty != null ? t.CounterParty.Name : t.BankReference,
                    accountId = t.AccountId,
                    amount = t.Debit,
                    tags = t.Tags,
                    categoryOverride = t.CategoryOverride,
                    subCategoryOverride = t.SubCategoryOverride,
                    merchantCategory = t.CounterParty != null ? t.CounterParty.Category : null
                });

            var rows = await projected.ToListAsync();

            if (isCategory)
            {
                var splitsLookup = await TransactionSplitHelper.GetSplitsLookupAsync(session, ids);
                var categoryRows = rows.SelectMany(r =>
                {
                    var expanded = TransactionSplitHelper.ExpandSpend(
                        r.accountId,
                        r.id,
                        r.bankType,
                        r.amount,
                        r.categoryOverride ?? r.merchantCategory ?? "Uncategorized",
                        r.subCategoryOverride,
                        splitsLookup);

                    return expanded
                        .Where(e => string.Equals(e.Category, groupValue, StringComparison.OrdinalIgnoreCase))
                        .Select(e => new
                        {
                            id = r.id,
                            date = r.date,
                            description = e.IsSplit
                                ? $"{r.description} (Split: {e.Category}{(string.IsNullOrWhiteSpace(e.Note) ? "" : $" - {e.Note}")})"
                                : r.description,
                            accountId = r.accountId,
                            amount = e.Amount
                        });
                }).ToList();

                return Ok(categoryRows);
            }

            IEnumerable<object> result = groupBy == "byTag"
                ? rows.Where(t => !string.IsNullOrWhiteSpace(t.tags)
                        && t.tags.Split(',').Select(tag => tag.Trim()).Contains(groupValue))
                      .Select(t => new { t.id, t.date, t.description, t.accountId, t.amount })
                : rows.Select(t => new { t.id, t.date, t.description, t.accountId, t.amount });

            return Ok(result.ToList());
        }
    }
}
