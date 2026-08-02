using Microsoft.AspNetCore.Mvc;
using NHibernate.Linq;
using Common.Framework.Data;
using Common.Framework.Web;
using BankStatementAnalytics.Dtos;
using BankStatementAnalytics.Models;
using BankStatementAnalytics.Services;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using System;

namespace BankStatementAnalytics.Controllers.Api
{
    [ApiController]
    [Route("api/merchants")]
    public class MerchantApiController : TenantControllerBase
    {
        // Aliases are stored for upload-time resolution (CounterPartyService matches
        // Aliases.Contains(name) so a same-named counterparty from another bank code still
        // resolves here), which means merging two same-named merchants records the primary's
        // own name as an alias. Those rows must stay in the DB, but showing them duplicates
        // the name in the UI and breaks the per-name transaction filter — so strip self-name
        // aliases and whitespace/case duplicates from API responses.
        private static List<string> DisplayAliases(Merchant merchant)
        {
            static string Normalize(string value) =>
                string.Join(" ", value.Split((char[])null, StringSplitOptions.RemoveEmptyEntries)).ToUpperInvariant();

            var seen = new HashSet<string> { Normalize(merchant.Name ?? string.Empty) };
            var aliases = new List<string>();
            foreach (var alias in merchant.Aliases)
            {
                if (string.IsNullOrWhiteSpace(alias)) continue;
                if (seen.Add(Normalize(alias)))
                    aliases.Add(alias.Trim());
            }
            return aliases;
        }

        // An empty box in the UI means "no value", not the empty string — otherwise a cleared
        // FriendlyName would still count as set and shadow the merchant's real name.
        private static string? NullIfBlank(string? value) =>
            string.IsNullOrWhiteSpace(value) ? null : value.Trim();

        // GET: api/merchants
        [HttpGet]
        public IActionResult GetAll([FromQuery] long accountId = 0, [FromQuery] string accountIds = null)
        {
            using var session = DbHelper.GetSession();

            var ownedAccountIds = AccountAccess.OwnedIdSet(session, CurrentUserId);
            var (status, scopeIds) = AccountAccess.ResolveScope(ownedAccountIds, accountIds, accountId);
            if (status == AccountAccess.ScopeStatus.NotFound)
                return NotFound();
            var filterByAccount = status == AccountAccess.ScopeStatus.Ok;

            var merchantEntities = session.Query<Merchant>()
                .Where(x => x.OwnerUserId == CurrentUserId)
                .FetchMany(x => x.UpiIds)
                .ToList();

            // Transaction count and total spend per merchant, scoped to this user's merchants
            // (not a scan of every user's transactions). Count and sum come from the same
            // GroupBy so surfacing spend costs no extra round trip.
            var ownedMerchantIds = merchantEntities.Select(m => m.Id).ToHashSet();
            var txQuery = session.Query<BankTransaction>()
                .Where(t => t.CounterParty != null && ownedMerchantIds.Contains(t.CounterParty.Id));
            if (filterByAccount)
                txQuery = txQuery.Where(t => scopeIds.Contains(t.AccountId));
            var txStats = txQuery
                .GroupBy(t => t.CounterParty.Id)
                .Select(g => new { Id = g.Key, Count = g.Count(), Spent = g.Sum(t => t.Debit) })
                .ToList()
                .ToDictionary(x => x.Id, x => (x.Count, x.Spent));

            var merchants = merchantEntities
                // Under an account filter a merchant only belongs if it has in-scope transactions.
                .Where(m => !filterByAccount || txStats.ContainsKey(m.Id))
                .Select(merchantEntity => new
                {
                    Id = merchantEntity.Id,
                    Name = merchantEntity.Name,
                    FriendlyName = merchantEntity.FriendlyName,
                    Notes = merchantEntity.Notes,
                    Category = merchantEntity.Category,
                    SubCategory = merchantEntity.SubCategory,
                    ShiftToNextMonth = merchantEntity.ShiftToNextMonth == true,
                    UpiIds = merchantEntity.UpiIds.Select(u => u.UpiId).ToList(),
                    Aliases = DisplayAliases(merchantEntity),
                    TransactionCount = txStats.TryGetValue(merchantEntity.Id, out var s) ? s.Count : 0,
                    TotalSpent = txStats.TryGetValue(merchantEntity.Id, out var t) ? t.Spent : 0m
                })
                .OrderByDescending(m => m.TransactionCount)
                .ThenBy(m => m.FriendlyName ?? m.Name)
                .ToList();

            return Ok(merchants);
        }

        // GET: api/merchants/{id}
        [HttpGet("{id}")]
        public IActionResult GetById(int id, [FromQuery] long accountId = 0, [FromQuery] string accountIds = null)
        {
            using var session = DbHelper.GetSession();

            var merchantEntity = session.Query<Merchant>()
                .Where(x => x.Id == id)
                .FetchMany(x => x.UpiIds)
                .SingleOrDefault();

            if (!Owns(merchantEntity))
                return NotFound();

            var ownedAccountIds = AccountAccess.OwnedIdSet(session, CurrentUserId);
            var (status, scopeIds) = AccountAccess.ResolveScope(ownedAccountIds, accountIds, accountId);
            if (status == AccountAccess.ScopeStatus.NotFound)
                return NotFound();
            var filterByAccount = status == AccountAccess.ScopeStatus.Ok;

            var txQuery = session.Query<BankTransaction>()
                .Where(x => x.CounterParty != null && x.CounterParty.Id == id);
            if (filterByAccount)
                txQuery = txQuery.Where(x => scopeIds.Contains(x.AccountId));

            // Ordered and projected in SQL: hydrating full entities pulled every column
            // (including the 2000-char narration/description) plus a merchant join, only
            // to read nine fields and re-sort them in memory. The merchant's own name and
            // category are the same for every row, so they're stitched on afterwards
            // rather than sent through the SQL projection.
            var allTransactions = txQuery
                .OrderByDescending(x => x.TransactionDate)
                .Select(x => new
                {
                    x.TransactionDate,
                    x.UpiReference,
                    x.Mode,
                    x.Debit,
                    x.Credit,
                    x.Balance,
                    x.Description,
                    x.BankType
                })
                .ToList()
                .Select(x => new
                {
                    TransactionDate = x.TransactionDate,
                    UpiReference = x.UpiReference,
                    Merchant = merchantEntity.Name,
                    Category = merchantEntity.Category,
                    Mode = x.Mode,
                    Debit = x.Debit,
                    Credit = x.Credit,
                    Balance = x.Balance,
                    Description = x.Description,
                    BankType = x.BankType
                })
                .ToList();

            var dto = new
            {
                Id = merchantEntity.Id,
                Name = merchantEntity.Name,
                FriendlyName = merchantEntity.FriendlyName,
                Category = merchantEntity.Category,
                SubCategory = merchantEntity.SubCategory,
                ShiftToNextMonth = merchantEntity.ShiftToNextMonth == true,
                BankCode = merchantEntity.BankCode,
                Notes = merchantEntity.Notes,
                UpiIds = merchantEntity.UpiIds.Select(u => u.UpiId).ToList(),
                Aliases = DisplayAliases(merchantEntity),
                Transactions = allTransactions
            };

            return Ok(dto);
        }

        // PUT: api/merchants/{id}
        [HttpPut("{id}")]
        public async Task<IActionResult> Update(int id, [FromBody] UpdateMerchantRequest request)
        {
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var merchantEntity = session.Get<Merchant>(id);
            if (!Owns(merchantEntity))
                return NotFound();

            var oldShift = merchantEntity.ShiftToNextMonth == true;

            merchantEntity.Category = request.Category;
            merchantEntity.SubCategory = request.SubCategory;
            merchantEntity.ShiftToNextMonth = request.ShiftToNextMonth;
            // Only touched when the caller actually sent the field — the list page's inline
            // category picker PUTs categorization alone, and must not blank out the rename
            // or notes as a side effect. See UpdateMerchantRequest for how "sent" is tracked.
            if (request.FriendlyNameSet)
                merchantEntity.FriendlyName = NullIfBlank(request.FriendlyName);
            if (request.NotesSet)
                merchantEntity.Notes = NullIfBlank(request.Notes);
            merchantEntity.UpdatedOn = DateTime.Now;

            await session.UpdateAsync(merchantEntity);

            if (oldShift != request.ShiftToNextMonth)
                await EffectiveDateCalculator.RecomputeForMerchantAsync(session, id, request.ShiftToNextMonth);

            await tx.CommitAsync();

            return NoContent();
        }

        // POST: api/merchants/bulk-category
        // Assign one category/sub-category to many merchants in a single round trip
        // (the list page's multi-select). ShiftToNextMonth is deliberately untouched —
        // it's a per-merchant timing rule, not part of categorization, so no
        // EffectiveDate recompute is needed here.
        [HttpPost("bulk-category")]
        public async Task<IActionResult> BulkCategory([FromBody] BulkCategoryRequest request)
        {
            if (request?.Ids == null || !request.Ids.Any())
                return BadRequest("Invalid request.");

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var ids = request.Ids.Distinct().ToList();
            // Ownership is enforced in the query rather than per row: ids belonging to
            // another user simply don't come back, so they're silently skipped.
            var merchants = session.Query<Merchant>()
                .Where(m => ids.Contains(m.Id) && m.OwnerUserId == CurrentUserId)
                .ToList();

            foreach (var merchant in merchants)
            {
                merchant.Category = request.Category;
                merchant.SubCategory = request.SubCategory;
                merchant.UpdatedOn = DateTime.Now;
                await session.UpdateAsync(merchant);
            }

            await tx.CommitAsync();

            return Ok(new { Updated = merchants.Count });
        }

        // GET: api/merchants/category-suggestions
        // Proposed categories for the user's uncategorized merchants (keyword rules +
        // similarity to already-categorized merchants). Review-only: nothing is applied
        // until the client POSTs the accepted rows back to /category-suggestions/apply.
        [HttpGet("category-suggestions")]
        public IActionResult CategorySuggestions()
        {
            using var session = DbHelper.GetSession();

            var merchants = session.Query<Merchant>()
                .Where(m => m.OwnerUserId == CurrentUserId)
                .FetchMany(m => m.UpiIds)
                .ToList();
            var categories = session.Query<Category>()
                .Where(c => c.OwnerUserId == CurrentUserId)
                .FetchMany(c => c.SubCategories)
                .ToList();

            return Ok(MerchantCategorySuggester.Suggest(merchants, categories));
        }

        // POST: api/merchants/category-suggestions/apply
        // Each row carries its own category/sub pair (unlike bulk-category's single pair).
        [HttpPost("category-suggestions/apply")]
        public async Task<IActionResult> ApplyCategorySuggestions([FromBody] ApplyCategorySuggestionsRequest request)
        {
            if (request?.Items == null || !request.Items.Any())
                return BadRequest("Invalid request.");

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var byId = request.Items
                .Where(i => !string.IsNullOrWhiteSpace(i.Category))
                .GroupBy(i => i.Id)
                .ToDictionary(g => g.Key, g => g.First());
            // Ownership enforced in the query — foreign ids just don't come back.
            var ids = byId.Keys.ToList();
            var merchants = session.Query<Merchant>()
                .Where(m => ids.Contains(m.Id) && m.OwnerUserId == CurrentUserId)
                .ToList();

            foreach (var merchant in merchants)
            {
                var item = byId[merchant.Id];
                merchant.Category = item.Category;
                merchant.SubCategory = NullIfBlank(item.SubCategory);
                merchant.UpdatedOn = DateTime.Now;
                await session.UpdateAsync(merchant);
            }

            await tx.CommitAsync();

            return Ok(new { Updated = merchants.Count });
        }

        // POST: api/merchants/merge
        [HttpPost("merge")]
        public async Task<IActionResult> Merge([FromBody] MergeMerchantsRequest request)
        {
            if (request == null || request.SecondaryIds == null || !request.SecondaryIds.Any())
                return BadRequest("Invalid request.");

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var primary = session.Query<Merchant>()
                .FetchMany(c => c.UpiIds)
                .SingleOrDefault(c => c.Id == request.PrimaryId);

            if (!Owns(primary)) return NotFound("Primary merchant not found.");

            foreach (var secId in request.SecondaryIds)
            {
                if (secId == request.PrimaryId) continue;

                var secondary = session.Query<Merchant>()
                    .FetchMany(c => c.UpiIds)
                    .SingleOrDefault(c => c.Id == secId);

                if (!Owns(secondary)) continue;

                // Remember the secondary's name so we don't recreate it on future uploads!
                if (!primary.Aliases.Contains(secondary.Name))
                {
                    primary.Aliases.Add(secondary.Name);
                }

                // Copy over any existing aliases the secondary had
                foreach (var alias in secondary.Aliases)
                {
                    if (!primary.Aliases.Contains(alias))
                    {
                        primary.Aliases.Add(alias);
                    }
                }

                // Copy unique UPI IDs to primary
                foreach (var upi in secondary.UpiIds.ToList())
                {
                    if (!primary.UpiIds.Any(u => string.Equals(u.UpiId, upi.UpiId, System.StringComparison.OrdinalIgnoreCase)))
                    {
                        var newUpi = new MerchantUpi
                        {
                            CounterParty = primary,
                            UpiId = upi.UpiId,
                            CreatedOn = upi.CreatedOn
                        };
                        primary.UpiIds.Add(newUpi);
                        await session.SaveAsync(newUpi);
                    }
                }
                // No need to clear secondary.UpiIds or delete them manually;
                // NHibernate's Cascade.All will delete them when we delete secondary.

                // Union account memberships so the stored bag stays truthful after the merge.
                foreach (var accId in secondary.AccountIds)
                {
                    if (!primary.AccountIds.Contains(accId))
                        primary.AccountIds.Add(accId);
                }

                // Reassign transactions to primary in one bulk UPDATE rather than loading and
                // updating each row. Runs directly against the DB (single unified table).
                await session.CreateQuery(
                        "update BankTransaction set CounterParty = :primary where CounterParty.Id = :secId")
                    .SetParameter("primary", primary)
                    .SetParameter("secId", secId)
                    .ExecuteUpdateAsync();

                await session.DeleteAsync(secondary);
            }

            // Reassigned rows must carry the primary's month-shift semantics: rows joining a
            // flagged primary get shifted, rows from a flagged secondary get cleared.
            await EffectiveDateCalculator.RecomputeForMerchantAsync(session, primary.Id, primary.ShiftToNextMonth == true);

            await session.UpdateAsync(primary);
            await tx.CommitAsync();

            return Ok();
        }

        // POST: api/merchants/unmerge
        [HttpPost("unmerge")]
        public async Task<IActionResult> Unmerge([FromBody] UnmergeRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.AliasName))
                return BadRequest("Invalid request.");

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var primary = session.Get<Merchant>(request.PrimaryId);
            if (!Owns(primary)) return NotFound("Primary merchant not found.");

            // Find and remove alias safely (handling potential trailing spaces)
            var aliasToRemove = primary.Aliases.FirstOrDefault(a => a != null && a.Trim().Equals(request.AliasName.Trim(), StringComparison.OrdinalIgnoreCase));
            if (aliasToRemove != null)
            {
                // Remove ALL instances of this alias if duplicates exist
                while (primary.Aliases.Contains(aliasToRemove))
                {
                    primary.Aliases.Remove(aliasToRemove);
                }
            }
            else
            {
                return BadRequest("Alias not found on this merchant.");
            }

            // Create new separated merchant
            var newCp = new Merchant
            {
                Name = request.AliasName,
                BankCode = primary.BankCode,
                OwnerUserId = primary.OwnerUserId,
                CreatedOn = DateTime.Now
            };
            await session.SaveAsync(newCp);

            var searchAlias = request.AliasName.Trim();
            var movedTxs = new List<BankTransaction>();

            // Re-assign transactions matched by string back to the unmerged entity
            var txs = session.Query<BankTransaction>().Where(t => t.CounterParty != null && t.CounterParty.Id == primary.Id).ToList();
            foreach (var t in txs)
            {
                if ((t.Description != null && t.Description.Contains(searchAlias, StringComparison.OrdinalIgnoreCase)) ||
                    (t.UpiReference != null && t.UpiReference.Contains(searchAlias, StringComparison.OrdinalIgnoreCase)))
                {
                    t.CounterParty = newCp;
                    t.EffectiveDate = null; // newCp is freshly created and unflagged
                    await session.UpdateAsync(t);
                    movedTxs.Add(t);
                }
            }

            // Restore UPI IDs that appear in the restored transactions
            foreach (var upi in primary.UpiIds.ToList())
            {
                bool matchesMovedTxs = movedTxs.Any(t =>
                    (t.Description != null && t.Description.Contains(upi.UpiId, StringComparison.OrdinalIgnoreCase)) ||
                    (t.Narration != null && t.Narration.Contains(upi.UpiId, StringComparison.OrdinalIgnoreCase)) ||
                    (t.UpiVpa != null && string.Equals(t.UpiVpa, upi.UpiId, StringComparison.OrdinalIgnoreCase)));

                if (matchesMovedTxs)
                {
                    var newUpi = new MerchantUpi
                    {
                        CounterParty = newCp,
                        UpiId = upi.UpiId,
                        CreatedOn = upi.CreatedOn
                    };
                    newCp.UpiIds.Add(newUpi);
                    await session.SaveAsync(newUpi);

                    primary.UpiIds.Remove(upi);
                    await session.DeleteAsync(upi);
                }
            }

            await session.UpdateAsync(primary);
            await tx.CommitAsync();

            return Ok();
        }
    }

    public class UpdateMerchantRequest
    {
        public string? Category { get; set; }
        public string? SubCategory { get; set; }
        public bool ShiftToNextMonth { get; set; }

        // FriendlyName/Notes are edited only from the detail drawer, while other callers PUT
        // categorization on its own. System.Text.Json invokes a setter only for properties
        // present in the payload, so the *Set flags distinguish "sent as empty" (clear it)
        // from "not sent at all" (leave it alone) — a plain null can't express both.
        private string? _friendlyName;
        public string? FriendlyName
        {
            get => _friendlyName;
            set { _friendlyName = value; FriendlyNameSet = true; }
        }

        private string? _notes;
        public string? Notes
        {
            get => _notes;
            set { _notes = value; NotesSet = true; }
        }

        [JsonIgnore] public bool FriendlyNameSet { get; private set; }
        [JsonIgnore] public bool NotesSet { get; private set; }
    }

    public class BulkCategoryRequest
    {
        public List<int> Ids { get; set; } = new List<int>();
        public string? Category { get; set; }
        public string? SubCategory { get; set; }
    }

    public class ApplyCategorySuggestionsRequest
    {
        public List<Item> Items { get; set; } = new List<Item>();

        public class Item
        {
            public int Id { get; set; }
            public string? Category { get; set; }
            public string? SubCategory { get; set; }
        }
    }

    public class MergeMerchantsRequest
    {
        public int PrimaryId { get; set; }
        public List<int> SecondaryIds { get; set; } = new List<int>();
    }

    public class UnmergeRequest
    {
        public int PrimaryId { get; set; }
        public string AliasName { get; set; } = string.Empty;
    }
}
