using BankStatementAnalytics.EnumClass;
using BankStatementAnalytics.Models;
using BankStatementAnalytics.Services;
using BankStatementAnalytics.Services.Parser;
using Common.Framework.Data;
using Common.Framework.Logging;
using Microsoft.AspNetCore.Mvc;
using NHibernate.Linq;
using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;

namespace BankStatementAnalytics.Controllers.Api
{
    [ApiController]
    [Route("api/statements")]
    public class StatementApiController : ControllerBase
    {
        private readonly TextService _textService;

        public StatementApiController(TextService textService)
        {
            _textService = textService;
        }

        // GET: api/statements/accounts
        [HttpGet("accounts")]
        public IActionResult GetAccounts()
        {
            try
            {
                return Ok(DbHelper.GetAll<Account>());
            }
            catch (Exception ex)
            {
                Log.Exception(ex);
                return StatusCode(500, "Internal server error");
            }
        }

        // GET: api/statements/{accountId}
        [HttpGet("{accountId}")]
        public async Task<IActionResult> GetTransactions(
     int accountId,
     [FromQuery] int page = 1,
     [FromQuery] int pageSize = 0,
     [FromQuery] int? year = null,
     [FromQuery] int? month = null,
     [FromQuery] DateTime? startDate = null,
     [FromQuery] DateTime? endDate = null)
        {
            try
            {
                var account = DbHelper.GetById<Account>((long)accountId);
                if (account == null)
                    return NotFound();

                using var session = DbHelper.GetSession();

                var bankType = account.BankName.ToString();

                var query = session.Query<BankTransaction>()
                    .Where(t => t.AccountId == accountId && t.BankType == bankType);

                if (year.HasValue && month.HasValue)
                {
                    query = query.Where(t => t.TransactionDate.Year == year.Value && t.TransactionDate.Month == month.Value);
                }
                else
                {
                    if (startDate.HasValue)
                        query = query.Where(t => t.TransactionDate >= startDate.Value.Date);
                    if (endDate.HasValue)
                    {
                        var endOfDay = endDate.Value.Date.AddDays(1).AddTicks(-1);
                        query = query.Where(t => t.TransactionDate <= endOfDay);
                    }
                }

                var totalCount = await query.CountAsync();

                var finalQuery = query.OrderByDescending(t => t.TransactionDate);

                IQueryable<BankTransaction> resultQuery = finalQuery;
                if (pageSize > 0)
                {
                    resultQuery = finalQuery.Skip((page - 1) * pageSize).Take(pageSize);
                }

                var pagedTransactions = await resultQuery.Select(t => new
                {
                    Id = t.BankReference,
                    TransactionDate = t.TransactionDate,
                    Description = t.Description,
                    UpiReference = t.UpiReference,
                    Merchant = t.CounterParty != null ? t.CounterParty.Name : "-",
                    Mode = t.Mode,
                    Debit = t.Debit,
                    Credit = t.Credit,
                    Balance = t.Balance,
                    BankType = bankType,
                    Category = t.CategoryOverride ?? (t.CounterParty != null ? t.CounterParty.Category : null),
                    SubCategory = t.SubCategoryOverride ?? (t.CounterParty != null ? t.CounterParty.SubCategory : null)
                }).ToListAsync();

                return Ok(new
                {
                    accountId,
                    account.AccountNumber,
                    account.BankName,
                    totalCount,
                    transactions = pagedTransactions
                });
            }
            catch (Exception ex)
            {
                Log.Exception(ex);
                return StatusCode(500, "Internal server error");
            }
        }

        // GET: api/statements/uploads
        [HttpGet("uploads")]
        public IActionResult GetUploads([FromQuery] int? accountId)
        {
            try
            {
                using var session = DbHelper.GetSession();
                var uploadsQuery = session.Query<Models.Upload>();

                if (accountId.HasValue)
                {
                    uploadsQuery = uploadsQuery.Where(u => u.AccountId == accountId.Value);
                }

                var uploads = uploadsQuery.ToList();

                var txCounts = session.Query<BankTransaction>()
                    .Where(t => t.UploadId != null)
                    .GroupBy(t => t.UploadId)
                    .Select(g => new { UploadId = g.Key, Count = g.Count() })
                    .ToList();

                var result = uploads.OrderByDescending(u => u.UploadedAt).Select(u => new
                {
                    u.Id,
                    u.FileName,
                    u.StoredName,
                    u.AccountId,
                    u.Path,
                    u.UploadedAt,
                    u.TransactionId,
                    TransactionCount = txCounts.FirstOrDefault(c => c.UploadId.HasValue &&
                     c.UploadId.Value == u.Id)?.Count ?? 0
                });

                return Ok(result);
            }
            catch (Exception ex)
            {
                Log.Exception(ex);
                return StatusCode(500, "Internal server error");
            }
        }

        // POST: api/statements/upload
        [HttpPost("upload")]
        public async Task<IActionResult> Upload(IFormFile file, [FromForm] int accountId)
        {
            try
            {
                if (file == null || file.Length == 0)
                    return BadRequest("File is empty");

                var folder = Path.Combine(AppContext.BaseDirectory, "Uploads");
                Directory.CreateDirectory(folder);

                var storedName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
                var path = Path.Combine(folder, storedName);

                using (var stream = new FileStream(path, FileMode.Create))
                    await file.CopyToAsync(stream);

                var ext = Path.GetExtension(file.FileName).ToLowerInvariant();

                var uploadId = Guid.NewGuid();
                var upload = new Models.Upload
                {
                    Id = uploadId,
                    FileName = file.FileName,
                    StoredName = storedName,
                    AccountId = accountId,
                    Path = $"/Uploads/{storedName}",
                    UploadedAt = DateTime.UtcNow
                };

                await DbHelper.SaveAsync(upload);

                var tx = new Models.UploadTransaction
                {
                    Id = Guid.NewGuid(),
                    UploadId = upload.Id,
                    Description = $"Uploaded statement {file.FileName}",
                    CreatedAt = DateTime.UtcNow
                };

                await DbHelper.SaveAsync(tx);

                upload.TransactionId = tx.Id;
                await DbHelper.UpdateAsync(upload);


                if (ext == ".txt")
                {
                    await _textService.ExtractAsync(path, accountId, uploadId, StatementFileFormat.Txt);
                }
                else if (ext == ".csv")
                {
                    await _textService.ExtractAsync(path, accountId, uploadId, StatementFileFormat.Csv);
                }
                else
                {
                    return BadRequest("Only TXT and CSV files are supported.");
                }

                using var session = DbHelper.GetSession();
                int txCount = session.Query<BankTransaction>().Count(t => t.UploadId == uploadId);

                return Ok(new
                {
                    upload.Id,
                    upload.FileName,
                    upload.StoredName,
                    upload.AccountId,
                    upload.Path,
                    upload.UploadedAt,
                    upload.TransactionId,
                    TransactionCount = txCount
                });
            }
            catch (Exception ex)
            {
                Log.Exception(ex);
                return StatusCode(500, "Internal server error");
            }
        }

        // DELETE: api/statements/upload/{id}
        [HttpDelete("upload/{id:guid}")]
        public async Task<IActionResult> DeleteUpload(Guid id)
        {
            try
            {
                var upload = DbHelper.GetById<Models.Upload>(id);
                if (upload == null)
                    return NotFound();

                if (upload.TransactionId.HasValue)
                {
                    var tx = DbHelper.GetById<Models.UploadTransaction>(upload.TransactionId.Value);
                    if (tx != null)
                    {
                        await DbHelper.DeleteAsync(tx);
                    }
                }

                using var session = DbHelper.GetSession();
                using var sessionTx = session.BeginTransaction();

                var transactions = session.Query<BankTransaction>().Where(t => t.UploadId == id).ToList();
                foreach (var t in transactions) { await session.DeleteAsync(t); }

                await sessionTx.CommitAsync();

                var folder = Path.Combine(AppContext.BaseDirectory, "Uploads");
                var filePath = Path.Combine(folder, upload.StoredName);
                if (System.IO.File.Exists(filePath))
                    System.IO.File.Delete(filePath);

                await DbHelper.DeleteAsync(upload);

                return Ok(new { message = "Reverted" });
            }
            catch (Exception ex)
            {
                Log.Exception(ex);
                return StatusCode(500, "Internal server error");
            }
        }
    }
}