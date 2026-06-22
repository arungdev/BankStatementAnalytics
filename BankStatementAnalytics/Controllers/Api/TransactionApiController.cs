using Microsoft.AspNetCore.Mvc;
using NHibernate.Linq;
using BankStatementAnalytics.Models;
using Common.Framework.Data;
using Common.Framework.Logging;
using System;
using System.Linq;
using System.Threading.Tasks;

namespace BankStatementAnalytics.Controllers.Api
{
    [ApiController]
    [Route("api/transactions")]
    public class TransactionApiController : ControllerBase
    {
        // GET: api/transactions?accountId=1
        [HttpGet]
        public IActionResult GetByAccount(int accountId)
        {
            try
            {
                var account = DbHelper.GetById<Account>((long)accountId);
                if (account == null)
                    return NotFound();

                var transactions = DbHelper
                    .GetAll<BankTransaction>()
                    .Where(x => x.AccountId == accountId)
                    .OrderByDescending(x => x.TransactionDate)
                    .ToList();

                var result = transactions.Select(t => new
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
                    Merchant = t.CounterParty?.Name,
                    Category = t.CategoryOverride ?? t.CounterParty?.Category,
                    SubCategory = t.SubCategoryOverride ?? t.CounterParty?.SubCategory,
                    HasCategoryOverride = !string.IsNullOrEmpty(t.CategoryOverride)
                });

                return Ok(result);
            }
            catch (Exception ex)
            {
                Log.Exception(ex);
                return StatusCode(500, "Internal server error");
            }
        }

        // PATCH: api/transactions/category
        [HttpPatch("category")]
        public async Task<IActionResult> UpdateCategory([FromBody] UpdateTransactionCategoryRequest request)
        {
            try
            {
                if (request == null || string.IsNullOrWhiteSpace(request.BankReference))
                    return BadRequest("Invalid request.");

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
            catch (Exception ex)
            {
                Log.Exception(ex);
                return StatusCode(500, "Internal server error");
            }
        }
        // PATCH: api/transactions/tags
        [HttpPatch("tags")]
        public async Task<IActionResult> UpdateTags([FromBody] UpdateTransactionTagsRequest request)
        {
            try
            {
                if (request == null || string.IsNullOrWhiteSpace(request.BankReference))
                    return BadRequest("Invalid request.");

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
            catch (Exception ex)
            {
                Log.Exception(ex);
                return StatusCode(500, "Internal server error");
            }
        }
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