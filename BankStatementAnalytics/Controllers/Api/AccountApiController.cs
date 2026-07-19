using BankStatementAnalytics.Data;
using BankStatementAnalytics.EnumClass;
using BankStatementAnalytics.Models;
using BankStatementAnalytics.Services;
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
    [Route("api/accounts")]
    public class AccountApiController : TenantControllerBase
    {
        // GET: api/accounts/{id}/supported-formats
        [HttpGet("{id}/supported-formats")]
        public IActionResult GetSupportedFormats(int id)
        {
            var account = DbHelper.GetById<Account>((long)id);
            if (!Owns(account)) return NotFound();

            // Registry-driven so new parser registrations (e.g. PDF) flow to the
            // client's file-picker accept attribute automatically.
            var (formats, label) = TextService.GetSupportedFormats(account.BankName);
            if (formats.Length == 0)
            {
                formats = new[] { ".txt" };
                label = "TXT";
            }

            return Ok(new
            {
                bankName = account.BankName.ToString(),
                formats,
                label,
                downloadGuide = DownloadGuide(account.BankName)
            });
        }

        // Per-bank guidance on where to export the supported statement file.
        private static object? DownloadGuide(Bank bank) => bank switch
        {
            Bank.HDFC => new
            {
                label = "HDFC Bank (.txt / .pdf)",
                steps = new[]
                {
                    "Log in to HDFC NetBanking.",
                    "Go to Accounts → Enquire → Statement of Account (or \"Download Historical Transactions\").",
                    "Pick the account and the date range you want.",
                    "Choose the \"Delimited (.txt)\" file type and download.",
                    "Or upload the monthly e-statement PDF emailed by the bank — enter its PDF password if it's protected."
                }
            },
            Bank.HDFCCreditCard => new
            {
                label = "HDFC Credit Card (.csv / .pdf)",
                steps = new[]
                {
                    "Log in to HDFC NetBanking.",
                    "Go to Cards → Credit Cards → View / Download Statement.",
                    "Select the card and billing period.",
                    "Download the statement in CSV format.",
                    "Or upload the monthly e-statement PDF emailed by the bank — enter its PDF password if it's protected."
                }
            },
            Bank.IOB => new
            {
                label = "Indian Overseas Bank (.txt / .pdf)",
                steps = new[]
                {
                    "Log in to IOB NetBanking.",
                    "Go to Account Statement / Statement of Account.",
                    "Select the account and the period you want.",
                    "Download / export the statement as a text (.txt) file.",
                    "Or upload the e-statement PDF — enter its PDF password if it's protected."
                }
            },
            _ => null
        };

        // GET: api/accounts/banks
        [HttpGet("banks")]
        public IActionResult GetBanks()
        {
            var banks = Enum.GetValues<Bank>()
                .Select(b => new { value = b.ToString(), label = BankLabel(b) });
            return Ok(banks);
        }

        private static string BankLabel(Bank bank) => bank switch
        {
            Bank.HDFC => "HDFC",
            Bank.HDFCCreditCard => "HDFC Credit Card",
            Bank.IOB => "IOB",
            _ => bank.ToString()
        };

        // GET: api/accounts
        [HttpGet]
        public async Task<IActionResult> GetAll()
        {
            var accounts = (await DbHelper.QueryAsync<Account>(a => a.OwnerUserId == CurrentUserId))
                .Select(a => new { a.Id, a.AccountHolderName, a.BankName, MaskedAccountNumber = a.MaskedAccountNumber });
            return Ok(accounts);
        }

        // GET: api/accounts/{id}
        [HttpGet("{id}")]
        public IActionResult GetById(int id)
        {
            var account = DbHelper.GetById<Account>((long)id);
            if (!Owns(account))
                return NotFound();

            var dto = new { account.Id, account.AccountHolderName, account.BankName, MaskedAccountNumber = account.MaskedAccountNumber };
            return Ok(dto);
        }

        // POST: api/accounts
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] Account account)
        {
            if (account == null)
                return BadRequest();

            // Mask account number before saving for safety
            account.AccountNumber = account.AccountNumber;
            account.OwnerUserId = CurrentUserId;

            await DbHelper.SaveAsync(account);

            var dto = new { account.Id, account.AccountHolderName, account.BankName, MaskedAccountNumber = account.MaskedAccountNumber };
            return CreatedAtAction(nameof(GetById), new { id = account.Id }, dto);
        }

        // PUT: api/accounts/{id}  — rename the account holder
        [HttpPut("{id}")]
        public async Task<IActionResult> Update(int id, [FromBody] UpdateAccountRequest request)
        {
            var account = DbHelper.GetById<Account>((long)id);
            if (!Owns(account))
                return NotFound();

            var name = request?.AccountHolderName?.Trim();
            if (string.IsNullOrEmpty(name))
                return BadRequest(new { message = "Account name is required." });

            account.AccountHolderName = name;
            await DbHelper.UpdateAsync(account);

            var dto = new { account.Id, account.AccountHolderName, account.BankName, MaskedAccountNumber = account.MaskedAccountNumber };
            return Ok(dto);
        }

        // GET: api/accounts/browse-folders  — server-side folder browser backing the
        // auto-import folder picker (a browser cannot read real filesystem paths).
        // No path → list drives; otherwise list that folder's subfolders.
        [HttpGet("browse-folders")]
        public IActionResult BrowseFolders([FromQuery] string? path)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                // Quick access first: the native Explorer dialog can't hand a web page
                // a real path, so surface the folders people actually keep statements in.
                var roots = new List<(string Name, string Path)>();
                try
                {
                    foreach (var profile in Directory.EnumerateDirectories(@"C:\Users"))
                    {
                        var user = Path.GetFileName(profile);
                        if (user is "Public" or "Default" or "Default User" or "All Users")
                            continue;
                        foreach (var sub in new[] { "Downloads", "Documents", "Desktop" })
                        {
                            var candidate = Path.Combine(profile, sub);
                            if (Directory.Exists(candidate))
                                roots.Add(($"{sub} ({user})", candidate));
                        }
                    }
                }
                catch { /* profile listing is best-effort */ }

                roots.AddRange(DriveInfo.GetDrives()
                    .Where(d => d.IsReady)
                    .Select(d => (d.Name, d.Name)));

                return Ok(new
                {
                    path = (string?)null,
                    parent = (string?)null,
                    folders = roots.Select(r => new { name = r.Name, path = r.Path })
                });
            }

            string full;
            try { full = Path.GetFullPath(path.Trim().Trim('"').Trim()); }
            catch { return BadRequest(new { message = "Invalid path." }); }

            if (!Directory.Exists(full))
                return BadRequest(new { message = "Folder not found or not accessible." });

            var folders = new List<(string Name, string Path)>();
            try
            {
                foreach (var dir in Directory.EnumerateDirectories(full))
                {
                    try
                    {
                        var info = new DirectoryInfo(dir);
                        if ((info.Attributes & (FileAttributes.Hidden | FileAttributes.System)) != 0)
                            continue;
                        folders.Add((info.Name, info.FullName));
                    }
                    catch { /* skip unreadable entries */ }
                }
            }
            catch (UnauthorizedAccessException)
            {
                return BadRequest(new { message = "Folder not found or not accessible." });
            }

            return Ok(new
            {
                path = full,
                parent = Directory.GetParent(full)?.FullName,
                folders = folders
                    .OrderBy(f => f.Name, StringComparer.OrdinalIgnoreCase)
                    .Select(f => new { name = f.Name, path = f.Path })
            });
        }

        // PUT: api/accounts/{id}/auto-import  — configure the watch folder the
        // background importer sweeps for this account, plus the optional PDF password.
        [HttpPut("{id}/auto-import")]
        public async Task<IActionResult> UpdateAutoImport(int id, [FromBody] UpdateAutoImportRequest request,
            [FromServices] WatchFolderImportService watcher)
        {
            var account = DbHelper.GetById<Account>((long)id);
            if (!Owns(account))
                return NotFound();

            // Trim quotes so Explorer's "Copy as path" (which wraps in ") pastes cleanly.
            var path = request?.WatchFolderPath?.Trim().Trim('"').Trim();
            if (string.IsNullOrEmpty(path))
            {
                account.WatchFolderPath = null;
            }
            else
            {
                // Checked in the service process on purpose: also surfaces
                // service-account permission problems at save time instead of
                // silently in the background watcher.
                if (!Directory.Exists(path))
                    return BadRequest(new { message = "Folder not found or not accessible." });
                account.WatchFolderPath = path;
            }

            // null = unchanged, empty string = clear, otherwise set.
            if (request?.StatementPassword != null)
                account.StatementPassword = request.StatementPassword.Length == 0 ? null : request.StatementPassword;

            // null = unchanged; the pause switch keeps the folder configured.
            if (request?.Enabled != null)
                account.WatchEnabled = request.Enabled;

            await DbHelper.UpdateAsync(account);

            // Sweep right away so the first import doesn't wait out the interval.
            if (!string.IsNullOrEmpty(account.WatchFolderPath) && account.WatchEnabled != false)
                watcher.TriggerSweep();

            return Ok(new
            {
                account.WatchFolderPath,
                WatchEnabled = account.WatchEnabled != false,
                HasStatementPassword = !string.IsNullOrEmpty(account.StatementPassword)
            });
        }

        // DELETE: api/accounts/{id}  — removes the account and all of its parsed
        // transactions, uploads (DB rows + files), mirroring the upload-revert cleanup.
        [HttpDelete("{id}")]
        public async Task<IActionResult> Delete(int id)
        {
            var account = DbHelper.GetById<Account>((long)id);
            if (!Owns(account))
                return NotFound();

            using var session = DbHelper.GetSession();
            using var sessionTx = session.BeginTransaction();

            var transactions = session.Query<BankTransaction>()
                .Where(t => t.AccountId == id)
                .ToList();

            // Merchants referenced by this account's transactions — candidates for
            // cleanup once the account is gone.
            var merchantIds = transactions
                .Where(t => t.CounterParty != null)
                .Select(t => t.CounterParty!.Id)
                .Distinct()
                .ToList();

            foreach (var t in transactions)
                await session.DeleteAsync(t);

            // Delete merchants that only belonged to this account; for merchants still
            // used by another account, just drop this account from their list.
            long accountId = id;
            foreach (var merchantId in merchantIds)
            {
                bool usedElsewhere = session.Query<BankTransaction>()
                    .Any(t => t.CounterParty.Id == merchantId);

                var merchant = session.Get<Merchant>(merchantId);
                if (merchant == null) continue;

                if (usedElsewhere)
                {
                    merchant.AccountIds.Remove(accountId);
                    await session.UpdateAsync(merchant);
                }
                else
                {
                    await session.DeleteAsync(merchant);
                }
            }

            var uploads = session.Query<Models.Upload>()
                .Where(u => u.AccountId == id)
                .ToList();

            foreach (var upload in uploads)
            {
                if (upload.TransactionId.HasValue)
                {
                    var uploadTx = session.Get<Models.UploadTransaction>(upload.TransactionId.Value);
                    if (uploadTx != null)
                        await session.DeleteAsync(uploadTx);
                }

                UploadStorage.DeleteFile(upload.StoredName);

                await session.DeleteAsync(upload);
            }

            await session.DeleteAsync(account);

            await sessionTx.CommitAsync();

            return Ok(new { message = "Account deleted." });
        }

        public class UpdateAccountRequest
        {
            public string? AccountHolderName { get; set; }
        }

        public class UpdateAutoImportRequest
        {
            public string? WatchFolderPath { get; set; }
            public string? StatementPassword { get; set; }
            public bool? Enabled { get; set; }
        }
    }
}
