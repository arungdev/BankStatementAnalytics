using Microsoft.AspNetCore.Mvc;
using BankStatementAnalytics.Data;
using BankStatementAnalytics.Dtos;
using BankStatementAnalytics.Models;
using BankStatementAnalytics.Services;
using BankStatementAnalytics.Services.Parser;
using Common.Framework.Data;
using Common.Framework.Logging;

namespace BankStatementAnalytics.Controllers
{
    public class StatementController : Controller
    {
        private readonly TextService _textService;   // ← add

        private readonly TransactionRepositoryFactory _repoFactory;

        public StatementController(
            TextService textService,
            TransactionRepositoryFactory repoFactory)
        {
            _textService = textService;
            _repoFactory = repoFactory;
        }

        // HOME - ACCOUNT LIST
        public IActionResult Index()
        {
            try
            {
                var accounts = DbHelper.GetAll<Account>();
                return NotFound();
            }
            catch (Exception ex)
            {
                Log.Exception(ex);
                return StatusCode(500, "Internal server error");
            }
        }

        // CREATE ACCOUNT
        public IActionResult CreateAccount()
        {
            try
            {
                return NotFound();
            }
            catch (Exception ex)
            {
                Log.Exception(ex);
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpPost]
        public async Task<IActionResult> CreateAccount(Account account)
        {
            try
            {
                // Mask account number before persisting to avoid storing full account numbers
                account.AccountNumber = Account.Mask(account.AccountNumber);
                await DbHelper.SaveAsync(account);
                return NoContent();
            }
            catch (Exception ex)
            {
                Log.Exception(ex);
                return StatusCode(500, "Internal server error");
            }
        }

        // DETAILS (TRANSACTIONS)
        public IActionResult Details(int id)
        {
            try
            {
                // Load account to get the bank name
                var account = DbHelper.GetById<Account>((long)id);
                if (account == null)
                    return NotFound();

                var transactions = _repoFactory
                    .GetRepository(account.BankName)
                    .GetByAccount(id);

                ViewBag.AccountId = id;
                ViewBag.AccountName = account.MaskedAccountNumber;
                ViewBag.Bank = account.BankName;

                return NotFound();
            }
            catch (Exception ex)
            {
                Log.Exception(ex);
                return StatusCode(500, "Internal server error");
            }
        }

        // UPLOAD PAGE
        [HttpGet]
        public IActionResult UploadForAccount(int id)
        {
            try
            {
                return NotFound();
            }
            catch (Exception ex)
            {
                Log.Exception(ex);
                return StatusCode(500, "Internal server error");
            }
        }

        // UPLOAD + PARSE ONLY
        [HttpPost]
        public async Task<IActionResult> UploadForAccount(IFormFile file, int accountId)
        {
            try
            {
                if (file == null || file.Length == 0)
                {
                    TempData["Error"] = "Please select a file before uploading.";
                    return RedirectToAction("Details", new { id = accountId });
                }

                var folder = Path.Combine(Directory.GetCurrentDirectory(), "Uploads");
                Directory.CreateDirectory(folder);
                var path = Path.Combine(folder, file.FileName);

                using (var stream = new FileStream(path, FileMode.Create))
                    await file.CopyToAsync(stream);

                var ext = Path.GetExtension(file.FileName).ToLowerInvariant();

                try
                {
                    if (ext == ".txt")
                    {
                        _textService.ExtractText(path, accountId, Guid.Empty);
                    }
                    else
                    {
                        TempData["Error"] = "Unsupported file type. Please upload a PDF, TXT, or CSV file.";
                    }
                }
                catch (NotSupportedException ex)
                {
                    Log.Exception(ex);
                    TempData["Error"] = $"Could not detect bank format: {ex.Message}";
                }
                catch (Exception ex)
                {
                    Log.Exception(ex);
                    TempData["Error"] = $"Parse error: {ex.Message}";
                }

                return RedirectToAction("Details", new { id = accountId });
            }
            catch (Exception ex)
            {
                Log.Exception(ex);
                return StatusCode(500, "Internal server error");
            }
        }
    }
}