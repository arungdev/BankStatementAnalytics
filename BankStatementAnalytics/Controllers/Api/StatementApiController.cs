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
        private readonly StatementImportService _importer;

        public StatementApiController(StatementImportService importer)
        {
            _importer = importer;
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

                decimal? balance;
                if (a.BankName == Bank.HDFCCreditCard)
                {
                    // Credit card statements carry no running balance, so derive the amount
                    // owed. Prefer anchoring on the latest parsed statement's billed total
                    // plus activity since (same rule as CardApiController.GetSummary) — the
                    // raw Σ(Debit−Credit) goes negative when history before the first
                    // uploaded statement is missing.
                    var latest = session.Query<CardStatementSummary>()
                        .Where(s => s.AccountId == a.Id)
                        .ToList()
                        .OrderByDescending(s => s.StatementDate ?? DateTime.MinValue)
                        .ThenByDescending(s => s.CreatedAt)
                        .FirstOrDefault();

                    balance = latest?.StatementDate != null && latest.TotalDue != null
                        ? latest.TotalDue.Value + (txns
                            .Where(t => t.TransactionDate > latest.StatementDate.Value)
                            .Sum(t => (decimal?)(t.Debit - t.Credit)) ?? 0m)
                        : txns.Sum(t => (decimal?)(t.Debit - t.Credit));
                }
                else
                {
                    balance = lastTxn?.Balance;
                }

                result.Add(new
                {
                    a.Id,
                    a.OwnerUserId,
                    a.AccountNumber,
                    a.AccountHolderName,
                    a.BankName,
                    a.BranchCode,
                    a.MaskedAccountNumber,
                    a.CreditLimit,
                    a.StatementDay,
                    a.SharedLimitAccountId,
                    a.WatchFolderPath,
                    WatchEnabled = a.WatchEnabled != false,
                    HasStatementPassword = !string.IsNullOrEmpty(a.StatementPassword),
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
     [FromQuery] string search = null,
     [FromQuery] Guid? uploadId = null)
        {
            var account = DbHelper.GetById<Account>((long)accountId);
            if (!Owns(account))
                return NotFound();

            using var session = DbHelper.GetSession();

            var bankType = BankTypeCode.For(account.BankName);

            var query = session.Query<BankTransaction>()
                .Where(t => t.AccountId == accountId && t.BankType == bankType);

            // Rows a specific upload added (duplicates keep their first upload's id,
            // so this is exactly that upload's "new" transactions).
            if (uploadId.HasValue)
                query = query.Where(t => t.UploadId == uploadId.Value);

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
                    u.AutoImported,
                    TotalCount = total,
                    NewCount = u.NewCount,
                    TransactionCount = total   // back-compat alias
                };
            });

            return Ok(result);
        }

        // POST: api/statements/auto-imports/sweep — run the watch-folder sweep now
        // instead of waiting out the interval ("Import now" in Settings). Responds
        // after the sweep finishes so the client can refetch and see the results,
        // capped so an unreachable folder can't hang the request indefinitely.
        [HttpPost("auto-imports/sweep")]
        public async Task<IActionResult> TriggerSweep([FromServices] WatchFolderImportService watcher)
        {
            var sweep = watcher.TriggerSweepAsync();
            var completed = await Task.WhenAny(sweep, Task.Delay(TimeSpan.FromSeconds(90))) == sweep;
            return Ok(new { completed });
        }

        // POST: api/statements/auto-imports/{historyId}/retry — re-attempt one
        // failed auto-import after supplying the PDF password ("Try again" in the
        // history). Re-imports that specific file directly and, on success, clears
        // its failed-history row; also saves the password for future statements.
        [HttpPost("auto-imports/{historyId:guid}/retry")]
        public async Task<IActionResult> RetryAutoImport(Guid historyId,
            [FromBody] RetryAutoImportRequest request)
        {
            var history = DbHelper.GetById<ImportHistory>(historyId);
            if (history == null)
                return NotFound();

            var account = DbHelper.GetById<Account>((long)history.AccountId);
            if (!Owns(account))
                return NotFound();

            if (string.IsNullOrEmpty(history.SourcePath) || !System.IO.File.Exists(history.SourcePath))
                return BadRequest(new { message = "The file is no longer in the watch folder." });

            var password = string.IsNullOrEmpty(request?.Password) ? account.StatementPassword : request!.Password;

            // Remember the password so future statements from this folder import automatically.
            if (!string.IsNullOrEmpty(request?.Password))
            {
                account.StatementPassword = request.Password;
                await DbHelper.UpdateAsync(account);
            }

            byte[] bytes;
            try { bytes = await System.IO.File.ReadAllBytesAsync(history.SourcePath); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                return BadRequest(new { message = "Could not read the file. It may be open or still downloading." });
            }

            var result = await _importer.ImportAsync(
                account, bytes, history.FileName, password, autoImported: true);

            switch (result.Outcome)
            {
                case ImportOutcome.Success:
                case ImportOutcome.Duplicate:
                    // Cleared: the failed row shouldn't linger once the file is in.
                    await DbHelper.DeleteAsync(history);
                    return Ok(new { result.Total, result.NewCount, duplicate = result.Outcome == ImportOutcome.Duplicate });
                default:
                    // Still failing (e.g. wrong password) — refresh the message/time in place.
                    history.Error = result.Error;
                    history.CreatedAt = DateTime.UtcNow;
                    await DbHelper.UpdateAsync(history);
                    return BadRequest(new { message = result.Error ?? "Import failed." });
            }
        }

        // GET: api/statements/auto-imports — watch-folder import attempts, including
        // failures (which leave no Upload row behind).
        [HttpGet("auto-imports")]
        public IActionResult GetAutoImports([FromQuery] int? accountId)
        {
            using var session = DbHelper.GetSession();

            var ownedAccountIds = AccountAccess.OwnedIdSet(session, CurrentUserId);

            if (accountId.HasValue && !ownedAccountIds.Contains(accountId.Value))
                return NotFound();

            var query = session.Query<ImportHistory>();
            if (accountId.HasValue)
                query = query.Where(h => h.AccountId == accountId.Value);

            var items = query.ToList()
                .Where(h => ownedAccountIds.Contains(h.AccountId))
                .OrderByDescending(h => h.CreatedAt)
                .Take(100)
                .Select(h => new { h.Id, h.AccountId, h.FileName, h.Status, h.Error, h.CreatedAt, h.UploadId });

            return Ok(items);
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

            byte[] bytes;
            using (var ms = new MemoryStream())
            {
                await file.CopyToAsync(ms);
                bytes = ms.ToArray();
            }

            var result = await _importer.ImportAsync(account, bytes, file.FileName, password, autoImported: false);

            // Friendly parse errors become explicit 400s (the global middleware
            // would flatten them into generic 500s); unexpected failures rethrow
            // inside ImportAsync for the middleware to log as a 500.
            if (result.Outcome == ImportOutcome.Duplicate)
                return Conflict(result.Error);
            if (result.Outcome == ImportOutcome.InvalidFile)
                return BadRequest(result.Error);

            var upload = result.Upload!;
            return Ok(new
            {
                upload.Id,
                upload.FileName,
                upload.StoredName,
                upload.AccountId,
                upload.Path,
                upload.UploadedAt,
                upload.TransactionId,
                TotalCount = result.Total,
                NewCount = result.NewCount,
                TransactionCount = result.Total   // back-compat alias
            });
        }

        // DELETE: api/statements/upload/{id}
        [HttpDelete("upload/{id:guid}")]
        public async Task<IActionResult> DeleteUpload(Guid id, [FromServices] WatchFolderImportService watcher)
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

            // A CC statement upload also produced a statement summary — revert it too.
            var summaries = session.Query<CardStatementSummary>().Where(s => s.UploadId == id).ToList();
            foreach (var s in summaries) { await session.DeleteAsync(s); }

            await sessionTx.CommitAsync();

            UploadStorage.DeleteFile(upload.StoredName);

            await DbHelper.DeleteAsync(upload);

            // The watcher remembers files it already processed; forget them so a
            // reverted statement still sitting in the watch folder imports again
            // on the next sweep (instead of only after a service restart).
            if (upload.AccountId.HasValue)
                watcher.ForgetAccount(upload.AccountId.Value);

            return Ok(new { message = "Reverted" });
        }

        public class RetryAutoImportRequest
        {
            public string? Password { get; set; }
        }
    }
}
