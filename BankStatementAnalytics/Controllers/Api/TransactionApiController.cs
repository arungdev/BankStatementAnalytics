using Microsoft.AspNetCore.Mvc;
using NHibernate.Criterion;
using NHibernate.Linq;
using BankStatementAnalytics.Models;
using Common.Framework.Data;
using Common.Framework.Web;
using System;
using System.Linq;
using System.Threading.Tasks;

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
                    t.Note
                })
                .ToListAsync();

            var result = rows.Select(t => new
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
                t.Note
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
