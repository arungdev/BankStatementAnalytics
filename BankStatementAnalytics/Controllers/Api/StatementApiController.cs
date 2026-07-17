using System.Collections.Generic;
using BankStatementAnalytics.EnumClass;
using BankStatementAnalytics.Models;
using BankStatementAnalytics.Services;
using BankStatementAnalytics.Services.Parser;
using BankStatementAnalytics.Services.Pdf;
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
        private readonly PdfStatementReader _pdfReader;

        public StatementApiController(TextService textService, PdfStatementReader pdfReader)
        {
            _textService = textService;
            _pdfReader = pdfReader;
        }

        // GET: api/statements/accounts
        [HttpGet("accounts")]
        public async Task<IActionResult> GetAccounts()
        {
            var accounts = await DbHelper.QueryAsync<Account>(a => a.OwnerUserId == CurrentUserId);

            using var session = DbHelper.GetSession();
            var result = new List<object>();
            foreach (var a in accounts)
            {
                var bankType = BankTypeCode.For(a.BankName);
                var txns = session.Query<BankTransaction>()
                    .Where(t => t.AccountId == a.Id && t.BankType == bankType);

                // No surrogate Id on BankTransaction; ImportedOn breaks same-date ties.
                var lastTxn = txns.OrderByDescending(t => t.TransactionDate)
                    .ThenByDescending(t => t.ImportedOn)
                    .Select(t => new
                    {
                        t.TransactionDate,
                        t.Description,
                        Merchant = t.CounterParty != null ? t.CounterParty.Name : null,
                        t.Debit,
                        t.Credit,
                        t.Balance
                    })
                    .FirstOrDefault();

                decimal? balance = a.BankName == Bank.HDFCCreditCard
                    // Credit card statements carry no running balance, so derive the amount owed.
                    ? txns.Sum(t => (decimal?)(t.Debit - t.Credit))
                    : lastTxn?.Balance;

                result.Add(new
                {
                    a.Id,
                    a.OwnerUserId,
                    a.AccountNumber,
                    a.AccountHolderName,
                    a.BankName,
                    a.BranchCode,
                    a.MaskedAccountNumber,
                    Balance = balance,
                    BalanceLabel = a.BankName == Bank.HDFCCreditCard ? "Outstanding" : "Balance",
                    LastTransaction = lastTxn == null ? null : new
                    {
                        Date = lastTxn.TransactionDate,
                        Description = !string.IsNullOrEmpty(lastTxn.Merchant) ? lastTxn.Merchant : lastTxn.Description,
                        Amount = lastTxn.Credit - lastTxn.Debit
                    }
                });
            }
            return Ok(result);
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
     [FromQuery] DateTime? endDate = null,
     [FromQuery] bool uncategorizedOnly = false,
     [FromQuery] string search = null)
        {
            var account = DbHelper.GetById<Account>((long)accountId);
            if (!Owns(account))
                return NotFound();

            using var session = DbHelper.GetSession();

            var bankType = BankTypeCode.For(account.BankName);

            var query = session.Query<BankTransaction>()
                .Where(t => t.AccountId == accountId && t.BankType == bankType);

            // Month attribution uses COALESCE(EffectiveDate, TransactionDate) so merchants
            // flagged ShiftToNextMonth (e.g. month-end salary) appear under the next month.
            if (year.HasValue && month.HasValue)
            {
                var monthStart = new DateTime(year.Value, month.Value, 1);
                var monthEnd = monthStart.AddMonths(1);
                query = query.Where(t => (t.EffectiveDate ?? t.TransactionDate) >= monthStart
                                      && (t.EffectiveDate ?? t.TransactionDate) < monthEnd);
            }
            else
            {
                if (startDate.HasValue)
                    query = query.Where(t => (t.EffectiveDate ?? t.TransactionDate) >= startDate.Value.Date);
                if (endDate.HasValue)
                {
                    var endOfDay = endDate.Value.Date.AddDays(1).AddTicks(-1);
                    query = query.Where(t => (t.EffectiveDate ?? t.TransactionDate) <= endOfDay);
                }
            }

            if (uncategorizedOnly)
            {
                // Uncategorized = no per-transaction override and no merchant default.
                query = query.Where(t =>
                    (t.CategoryOverride == null || t.CategoryOverride == "") &&
                    (t.CounterParty == null || t.CounterParty.Category == null || t.CounterParty.Category == ""));
            }

            if (!string.IsNullOrWhiteSpace(search))
            {
                var term = search.Trim();
                query = query.Where(t =>
                    (t.CounterParty != null && t.CounterParty.Name.Contains(term)) ||
                    t.Description.Contains(term) ||
                    t.UpiReference.Contains(term));
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
            using var session = DbHelper.GetSession();

            var ownedAccountIds = AccountAccess.OwnedIdSet(session, CurrentUserId);

            if (accountId.HasValue && !ownedAccountIds.Contains(accountId.Value))
                return NotFound();

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

            // Only count transactions tied to the uploads we're actually returning.
            var uploadIds = uploads.Select(u => u.Id).ToHashSet();
            var txCounts = session.Query<BankTransaction>()
                .Where(t => t.UploadId != null && uploadIds.Contains(t.UploadId.Value))
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
        public async Task<IActionResult> Upload(IFormFile file, [FromForm] int accountId, [FromForm] string? password = null)
        {
            var account = DbHelper.GetById<Account>((long)accountId);
            if (!Owns(account))
                return NotFound();

            if (file == null || file.Length == 0)
                return BadRequest("File is empty");

            var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (ext != ".txt" && ext != ".csv" && ext != ".pdf")
                return BadRequest("Only TXT, CSV and PDF files are supported.");

            // Read once so we can both hash (for duplicate detection) and persist the bytes.
            byte[] bytes;
            using (var ms = new MemoryStream())
            {
                await file.CopyToAsync(ms);
                bytes = ms.ToArray();
            }

            // Pre-flight PDFs BEFORE any DB write: a wrong password / scanned PDF
            // must not leave an Upload row behind, or the corrected retry would
            // trip the duplicate-hash check below and 409.
            if (ext == ".pdf")
            {
                try
                {
                    _pdfReader.Validate(bytes, password);
                }
                catch (PdfExtractionException pex)
                {
                    return BadRequest(pex.Message);
                }
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

            var accountFolder = UploadStorage.AccountFolderName(account);
            var folder = Path.Combine(UploadStorage.Root, accountFolder);
            Directory.CreateDirectory(folder);

            var storedName = $"{accountFolder}/{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
            var path = Path.Combine(UploadStorage.Root, storedName);

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

            var tx = new Models.UploadTransaction
            {
                Id = Guid.NewGuid(),
                UploadId = upload.Id,
                Description = $"Uploaded statement {file.FileName}",
                CreatedAt = DateTime.UtcNow
            };
            upload.TransactionId = tx.Id;

            // Persist the upload + its transaction record in one round-trip instead of three.
            using (var session = DbHelper.GetSession())
            using (var saveTx = session.BeginTransaction())
            {
                await session.SaveAsync(upload);
                await session.SaveAsync(tx);
                await saveTx.CommitAsync();
            }

            var format = ext switch
            {
                ".csv" => StatementFileFormat.Csv,
                ".pdf" => StatementFileFormat.Pdf,
                _ => StatementFileFormat.Txt,
            };

            int total, newCount;
            try
            {
                (total, newCount) = await _textService.ExtractAsync(
                    path, accountId, uploadId, format, password);
            }
            catch (Exception ex)
            {
                // Extraction/import failed after the Upload row was written — roll
                // back the stored file and DB rows so a corrected retry doesn't 409
                // on the duplicate-hash check. Friendly parse errors become explicit
                // 400s (the global middleware would flatten them into a generic 500);
                // anything else rethrows for the middleware to log as a 500.
                using (var session = DbHelper.GetSession())
                using (var cleanupTx = session.BeginTransaction())
                {
                    await session.DeleteAsync(tx);
                    await session.DeleteAsync(upload);
                    await cleanupTx.CommitAsync();
                }
                UploadStorage.DeleteFile(storedName);

                if (ex is PdfExtractionException or NotSupportedException)
                    return BadRequest(ex.Message);
                throw;
            }

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

            UploadStorage.DeleteFile(upload.StoredName);

            await DbHelper.DeleteAsync(upload);

            return Ok(new { message = "Reverted" });
        }
    }
}
