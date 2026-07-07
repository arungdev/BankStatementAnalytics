using BankStatementAnalytics.EnumClass;
using BankStatementAnalytics.Models;
using BankStatementAnalytics.Services;
using BankStatementAnalytics.Services.Parser;
using Common.Framework.Data;
using Common.Framework.Web;
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
    public class StatementApiController : TenantControllerBase
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
            return Ok(DbHelper.GetAll<Account>().Where(a => a.OwnerUserId == CurrentUserId));
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
            var account = DbHelper.GetById<Account>((long)accountId);
            if (!Owns(account))
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

            var projectedQuery = query
                .OrderByDescending(t => t.TransactionDate)
                .Select(t => new
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
                    SubCategory = t.SubCategoryOverride ?? (t.CounterParty != null ? t.CounterParty.SubCategory : null),
                    Tags = t.Tags != null ? t.Tags.Split(',').ToList() : new List<string>(),
                    Note = t.Note
                });

            var paged = await projectedQuery.ToPagedResultAsync(page, pageSize);

            return Ok(new
            {
                accountId,
                account.AccountNumber,
                account.BankName,
                totalCount = paged.TotalCount,
                transactions = paged.Items
            });
        }

        // GET: api/statements/uploads
        [HttpGet("uploads")]
        public IActionResult GetUploads([FromQuery] int? accountId)
        {
            var ownedAccountIds = DbHelper.GetAll<Account>()
                .Where(a => a.OwnerUserId == CurrentUserId)
                .Select(a => (int)a.Id)
                .ToHashSet();

            if (accountId.HasValue && !ownedAccountIds.Contains(accountId.Value))
                return NotFound();

            using var session = DbHelper.GetSession();
            var uploadsQuery = session.Query<Models.Upload>();

            if (accountId.HasValue)
            {
                uploadsQuery = uploadsQuery.Where(u => u.AccountId == accountId.Value);
            }

            // Never return uploads across accounts the caller doesn't own, even when
            // accountId is omitted (the "all uploads" path).
            var uploads = uploadsQuery.ToList()
                .Where(u => u.AccountId.HasValue && ownedAccountIds.Contains(u.AccountId.Value))
                .ToList();

            var txCounts = session.Query<BankTransaction>()
                .Where(t => t.UploadId != null)
                .GroupBy(t => t.UploadId)
                .Select(g => new { UploadId = g.Key, Count = g.Count() })
                .ToList();

            var result = uploads.OrderByDescending(u => u.UploadedAt).Select(u =>
            {
                // Legacy uploads (created before total/new tracking) have 0 stored - fall back
                // to the count of transactions tied to this UploadId for the total.
                var tiedCount = txCounts.FirstOrDefault(c => c.UploadId.HasValue && c.UploadId.Value == u.Id)?.Count ?? 0;
                var total = u.TotalCount > 0 ? u.TotalCount : tiedCount;
                return new
                {
                    u.Id,
                    u.FileName,
                    u.StoredName,
                    u.AccountId,
                    u.Path,
                    u.UploadedAt,
                    u.TransactionId,
                    TotalCount = total,
                    NewCount = u.NewCount,
                    TransactionCount = total   // back-compat alias
                };
            });

            return Ok(result);
        }

        // POST: api/statements/upload
        [HttpPost("upload")]
        public async Task<IActionResult> Upload(IFormFile file, [FromForm] int accountId)
        {
            var account = DbHelper.GetById<Account>((long)accountId);
            if (!Owns(account))
                return NotFound();

            if (file == null || file.Length == 0)
                return BadRequest("File is empty");

            var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (ext != ".txt" && ext != ".csv")
                return BadRequest("Only TXT and CSV files are supported.");

            // Read once so we can both hash (for duplicate detection) and persist the bytes.
            byte[] bytes;
            using (var ms = new MemoryStream())
            {
                await file.CopyToAsync(ms);
                bytes = ms.ToArray();
            }
            var fileHash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes));

            // Reject an exact re-upload of the same file for the same account.
            using (var checkSession = DbHelper.GetSession())
            {
                bool alreadyUploaded = checkSession.Query<Models.Upload>()
                    .Any(u => u.AccountId == accountId && u.FileHash == fileHash);
                if (alreadyUploaded)
                    return Conflict("This statement file has already been uploaded for this account.");
            }

            var folder = Path.Combine(AppContext.BaseDirectory, "Uploads");
            Directory.CreateDirectory(folder);

            var storedName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
            var path = Path.Combine(folder, storedName);

            await System.IO.File.WriteAllBytesAsync(path, bytes);

            var uploadId = Guid.NewGuid();
            var upload = new Models.Upload
            {
                Id = uploadId,
                FileName = file.FileName,
                StoredName = storedName,
                AccountId = accountId,
                Path = $"/Uploads/{storedName}",
                UploadedAt = DateTime.UtcNow,
                FileHash = fileHash
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


            var (total, newCount) = await _textService.ExtractAsync(
                path, accountId, uploadId,
                ext == ".csv" ? StatementFileFormat.Csv : StatementFileFormat.Txt);

            upload.TotalCount = total;
            upload.NewCount = newCount;
            await DbHelper.UpdateAsync(upload);

            return Ok(new
            {
                upload.Id,
                upload.FileName,
                upload.StoredName,
                upload.AccountId,
                upload.Path,
                upload.UploadedAt,
                upload.TransactionId,
                TotalCount = total,
                NewCount = newCount,
                TransactionCount = total   // back-compat alias
            });
        }

        // DELETE: api/statements/upload/{id}
        [HttpDelete("upload/{id:guid}")]
        public async Task<IActionResult> DeleteUpload(Guid id)
        {
            var upload = DbHelper.GetById<Models.Upload>(id);
            if (upload == null)
                return NotFound();

            var uploadAccount = upload.AccountId.HasValue ? DbHelper.GetById<Account>((long)upload.AccountId.Value) : null;
            if (!Owns(uploadAccount))
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
    }
}
