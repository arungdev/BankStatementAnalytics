using Microsoft.AspNetCore.Mvc;
using NHibernate.Criterion;
using NHibernate.Linq;
using BankStatementAnalytics.Models;
using Common.Framework.Data;
using Common.Framework.Web;
using System;
using System.Linq;
using System.Threading.Tasks;
using BankStatementAnalytics.Services;

namespace BankStatementAnalytics.Controllers.Api
{
    [ApiController]
    [Route("api/transactions")]
    public class TransactionApiController : TenantControllerBase
    {
        // GET: api/transactions?accountId=1
        [HttpGet]
        public async Task<IActionResult> GetByAccount(int accountId)
        {
            var account = await DbHelper.GetByIdAsync<Account>((long)accountId);
            if (!Owns(account))
                return NotFound();

            using var session = DbHelper.GetSession();

            // Project only the needed columns server-side (async, ordered in SQL) rather than
            // hydrating whole entities and their CounterParty via lazy loads.
            var rows = await session.Query<BankTransaction>()
                .Where(t => t.AccountId == accountId)
                .OrderByDescending(t => t.TransactionDate)
                .Select(t => new
                {
                    t.AccountId,
                    t.BankReference,
                    t.BankType,
                    t.TransactionDate,
                    t.Description,
                    t.Debit,
                    t.Credit,
                    t.Balance,
                    t.Mode,
                    t.UpiReference,
                    MerchantName = t.CounterParty != null ? t.CounterParty.Name : null,
                    MerchantCategory = t.CounterParty != null ? t.CounterParty.Category : null,
                    MerchantSubCategory = t.CounterParty != null ? t.CounterParty.SubCategory : null,
                    t.CategoryOverride,
                    t.SubCategoryOverride,
                    t.Note,
                    t.OriginalCurrency,
                    t.OriginalAmount,
                    t.ForexMarkupPercent
                })
                .ToListAsync();

            var splitsLookup = await TransactionSplitHelper.GetSplitsLookupAsync(session, accountId);

            var result = rows.Select(t =>
            {
                var splits = splitsLookup[new TransactionSplitHelper.SplitParentKey(t.AccountId, t.BankReference, t.BankType ?? string.Empty)].ToList();
                return new
                {
                    t.AccountId,
                    t.BankReference,
                    t.BankType,
                    t.TransactionDate,
                    t.Description,
                    t.Debit,
                    t.Credit,
                    t.Balance,
                    t.Mode,
                    t.UpiReference,
                    Merchant = t.MerchantName,
                    Category = t.CategoryOverride ?? t.MerchantCategory,
                    SubCategory = t.SubCategoryOverride ?? t.MerchantSubCategory,
                    HasCategoryOverride = !string.IsNullOrEmpty(t.CategoryOverride),
                    HasSplits = splits.Count > 0,
                    SplitsCount = splits.Count,
                    SplitCategories = splits.Select(s => s.Category).Where(c => !string.IsNullOrEmpty(c)).Distinct().ToList(),
                    Splits = splits.Select(s => new
                    {
                        s.Amount,
                        s.Category,
                        s.SubCategory,
                        s.Note
                    }).ToList(),
                    t.Note,
                    t.OriginalCurrency,
                    t.OriginalAmount,
                    t.ForexMarkupPercent
                };
            });

            return Ok(result);
        }

        // PATCH: api/transactions/category
        [HttpPatch("category")]
        public async Task<IActionResult> UpdateCategory([FromBody] UpdateTransactionCategoryRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.BankReference))
                return BadRequest("Invalid request.");

            var account = DbHelper.GetById<Account>(request.AccountId);
            if (!Owns(account))
                return NotFound();

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var transaction = session.Query<BankTransaction>()
                .SingleOrDefault(t => t.AccountId == request.AccountId
                                    && t.BankReference == request.BankReference
                                    && t.BankType == request.BankType);

            if (transaction == null)
                return NotFound();

            transaction.CategoryOverride = string.IsNullOrWhiteSpace(request.Category) ? null : request.Category;
            transaction.SubCategoryOverride = string.IsNullOrWhiteSpace(request.SubCategory) ? null : request.SubCategory;

            await session.UpdateAsync(transaction);
            await tx.CommitAsync();

            return Ok(new
            {
                Category = transaction.CategoryOverride ?? transaction.CounterParty?.Category,
                SubCategory = transaction.SubCategoryOverride ?? transaction.CounterParty?.SubCategory,
                HasCategoryOverride = !string.IsNullOrEmpty(transaction.CategoryOverride)
            });
        }
        // PATCH: api/transactions/tags
        [HttpPatch("tags")]
        public async Task<IActionResult> UpdateTags([FromBody] UpdateTransactionTagsRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.BankReference))
                return BadRequest("Invalid request.");

            var account = DbHelper.GetById<Account>(request.AccountId);
            if (!Owns(account))
                return NotFound();

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var transaction = session.Query<BankTransaction>()
                .SingleOrDefault(t => t.AccountId == request.AccountId
                                    && t.BankReference == request.BankReference
                                    && t.BankType == request.BankType);

            if (transaction == null)
                return NotFound();

            // Convert list to comma-separated string, or null if empty
            transaction.Tags = request.Tags != null && request.Tags.Count > 0
                ? string.Join(",", request.Tags.Select(t => t.Trim().ToLower()))
                : null;

            await session.UpdateAsync(transaction);
            await tx.CommitAsync();

            return Ok(new
            {
                Tags = transaction.Tags
            });
        }

        // PATCH: api/transactions/note
        [HttpPatch("note")]
        public async Task<IActionResult> UpdateNote([FromBody] UpdateTransactionNoteRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.BankReference))
                return BadRequest("Invalid request.");

            var account = DbHelper.GetById<Account>(request.AccountId);
            if (!Owns(account))
                return NotFound();

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var transaction = session.Query<BankTransaction>()
                .SingleOrDefault(t => t.AccountId == request.AccountId
                                    && t.BankReference == request.BankReference
                                    && t.BankType == request.BankType);

            if (transaction == null)
                return NotFound();

            transaction.Note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim();

            await session.UpdateAsync(transaction);
            await tx.CommitAsync();

            return Ok(new
            {
                Note = transaction.Note
            });
        }

        // PATCH: api/transactions/bulk
        // Applies one action to many transactions of a single account in one round trip —
        // the single-row endpoints above stay the path for inline edits.
        [HttpPatch("bulk")]
        public async Task<IActionResult> BulkUpdate([FromBody] BulkUpdateTransactionsRequest request)
        {
            if (request == null || request.BankReferences == null || request.BankReferences.Count == 0)
                return BadRequest("No transactions selected.");

            var action = (request.Action ?? string.Empty).Trim().ToLowerInvariant();
            if (action != "category" && action != "addtag" && action != "removetag")
                return BadRequest("Unknown bulk action.");

            var tagValue = (request.Tag ?? string.Empty).Trim().ToLowerInvariant();
            if (action != "category" && string.IsNullOrEmpty(tagValue))
                return BadRequest("Tag is required for this action.");

            var account = DbHelper.GetById<Account>(request.AccountId);
            if (!Owns(account))
                return NotFound();

            var refs = request.BankReferences
                .Where(r => !string.IsNullOrWhiteSpace(r))
                .Distinct()
                .ToList();

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            // The selection can span more rows than SQLite's parameter limit allows in a
            // single IN (...), so fetch in chunks and update within the one transaction.
            const int chunkSize = 250;
            var updated = 0;

            foreach (var chunk in refs.Chunk(chunkSize))
            {
                var batch = chunk.ToList();
                var transactions = await session.Query<BankTransaction>()
                    .Where(t => t.AccountId == request.AccountId
                             && t.BankType == request.BankType
                             && batch.Contains(t.BankReference))
                    .ToListAsync();

                foreach (var transaction in transactions)
                {
                    switch (action)
                    {
                        case "category":
                            transaction.CategoryOverride = string.IsNullOrWhiteSpace(request.Category) ? null : request.Category;
                            transaction.SubCategoryOverride = string.IsNullOrWhiteSpace(request.SubCategory) ? null : request.SubCategory;
                            break;

                        case "addtag":
                        {
                            var tags = SplitTags(transaction.Tags);
                            if (tags.Contains(tagValue)) continue; // already tagged — leave it untouched
                            tags.Add(tagValue);
                            transaction.Tags = string.Join(",", tags);
                            break;
                        }

                        case "removetag":
                        {
                            var tags = SplitTags(transaction.Tags);
                            if (!tags.Remove(tagValue)) continue; // wasn't tagged — nothing to do
                            transaction.Tags = tags.Count > 0 ? string.Join(",", tags) : null;
                            break;
                        }
                    }

                    await session.UpdateAsync(transaction);
                    updated++;
                }
            }

            await tx.CommitAsync();

            return Ok(new { Updated = updated, Requested = refs.Count });
        }

        /// <summary>Comma-separated Tags column → a normalised, de-duplicated list.</summary>
        private static List<string> SplitTags(string? tags) =>
            string.IsNullOrWhiteSpace(tags)
                ? new List<string>()
                : tags.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                      .Select(t => t.ToLowerInvariant())
                      .Distinct()
                      .ToList();

        // GET: api/transactions/splits?bankRef=...&bankType=...&accountId=...
        [HttpGet("splits")]
        public async Task<IActionResult> GetSplits(
            [FromQuery] string bankRef,
            [FromQuery] string bankType,
            [FromQuery] long accountId)
        {
            var account = await DbHelper.GetByIdAsync<Account>(accountId);
            if (!Owns(account)) return NotFound();

            using var session = DbHelper.GetSession();

            var splits = await session.Query<TransactionSplit>()
                .Where(s => s.ParentAccountId == accountId &&
                            s.ParentBankReference == bankRef &&
                            s.ParentBankType == bankType)
                .OrderBy(s => s.Id)
                .ToListAsync();

            return Ok(splits);
        }

        // POST: api/transactions/split
        [HttpPost("split")]
        public async Task<IActionResult> SaveSplits([FromBody] SaveSplitsRequest req)
        {
            if (req == null || string.IsNullOrWhiteSpace(req.BankReference))
                return BadRequest("BankReference is required.");

            var account = await DbHelper.GetByIdAsync<Account>(req.AccountId);
            if (!Owns(account)) return NotFound();

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            // Remove existing splits
            var existing = await session.Query<TransactionSplit>()
                .Where(s => s.ParentAccountId == req.AccountId &&
                            s.ParentBankReference == req.BankReference &&
                            s.ParentBankType == req.BankType)
                .ToListAsync();

            foreach (var e in existing)
                await session.DeleteAsync(e);

            if (req.Splits != null && req.Splits.Count > 0)
            {
                foreach (var item in req.Splits)
                {
                    if (item.Amount <= 0) continue;
                    var split = new TransactionSplit
                    {
                        OwnerUserId = CurrentUserId,
                        ParentAccountId = req.AccountId,
                        ParentBankReference = req.BankReference,
                        ParentBankType = req.BankType,
                        Amount = item.Amount,
                        Category = item.Category?.Trim(),
                        SubCategory = item.SubCategory?.Trim(),
                        Note = item.Note?.Trim(),
                        CreatedOn = DateTime.Now
                    };
                    await session.SaveAsync(split);
                }
            }

            await tx.CommitAsync();
            return Ok(new { success = true });
        }
    }

    public class SaveSplitsRequest
    {
        public long AccountId { get; set; }
        public string BankReference { get; set; } = string.Empty;
        public string BankType { get; set; } = string.Empty;
        public List<SplitItemDto> Splits { get; set; } = new();
    }

    public class SplitItemDto
    {
        public decimal Amount { get; set; }
        public string? Category { get; set; }
        public string? SubCategory { get; set; }
        public string? Note { get; set; }
    }

    public class BulkUpdateTransactionsRequest
    {
        public long AccountId { get; set; }
        public string BankType { get; set; } = string.Empty;
        public List<string> BankReferences { get; set; } = new();
        /// <summary>"category", "addTag" or "removeTag".</summary>
        public string Action { get; set; } = string.Empty;
        public string? Category { get; set; }
        public string? SubCategory { get; set; }
        public string? Tag { get; set; }
    }

    public class UpdateTransactionNoteRequest
    {
        public long AccountId { get; set; }
        public string BankReference { get; set; } = string.Empty;
        public string BankType { get; set; } = string.Empty;
        public string? Note { get; set; }
    }

    public class UpdateTransactionTagsRequest
    {
        public long AccountId { get; set; }
        public string BankReference { get; set; } = string.Empty;
        public string BankType { get; set; } = string.Empty;
        public List<string> Tags { get; set; } = new();
    }

    public class UpdateTransactionCategoryRequest
    {
        public long AccountId { get; set; }
        public string BankReference { get; set; } = string.Empty;
        public string BankType { get; set; } = string.Empty;
        public string? Category { get; set; }
        public string? SubCategory { get; set; }
    }
}
