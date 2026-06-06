using Microsoft.AspNetCore.Mvc;
using BankStatementAnalytics.Data;
using BankStatementAnalytics.Dtos;
using BankStatementAnalytics.Models;
using BankStatementAnalytics.Services;
using BankStatementAnalytics.Services.Parser;

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
            var accounts = DbHelper.GetAll<Account>();
            return View(accounts);
        }

        // CREATE ACCOUNT
        public IActionResult CreateAccount()
        {
            ViewBag.Banks = new List<string>
    {
        "IOB",
        "HDFC"
    };

            return View();
        }

        [HttpPost]
        public async Task<IActionResult> CreateAccount(Account account)
        {
            // Mask account number before persisting to avoid storing full account numbers
            account.AccountNumber = Account.Mask(account.AccountNumber);
            await DbHelper.SaveAsync(account);
            return RedirectToAction("Index");
        }

        // DETAILS (TRANSACTIONS)
        public IActionResult Details(int id)
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

            return View(transactions);
        }

        // UPLOAD PAGE
        [HttpGet]
        public IActionResult UploadForAccount(int id)
        {
            ViewBag.AccountId = id;
            return View();
        }

        // UPLOAD + PARSE ONLY
        [HttpPost]
        public async Task<IActionResult> UploadForAccount(IFormFile file, int accountId)
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
                    _textService.ExtractText(path, accountId);
                }
                else
                {
                    TempData["Error"] = "Unsupported file type. Please upload a PDF, TXT, or CSV file.";
                }
            }
            catch (NotSupportedException ex)
            {
                TempData["Error"] = $"Could not detect bank format: {ex.Message}";
            }
            catch (Exception ex)
            {
                TempData["Error"] = $"Parse error: {ex.Message}";
            }

            return RedirectToAction("Details", new { id = accountId });
        }
    }
}