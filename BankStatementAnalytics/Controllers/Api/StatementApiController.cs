using Microsoft.AspNetCore.Mvc;
using BankStatementAnalytics.Data;
using BankStatementAnalytics.Models;
using BankStatementAnalytics.Services;
using BankStatementAnalytics.Services.Parser;

namespace BankStatementAnalytics.Controllers.Api
{
    [ApiController]
    [Route("api/statements")]
    public class StatementApiController : ControllerBase
    {
        private readonly TextService _textService;
        private readonly TransactionRepositoryFactory _repoFactory;

        public StatementApiController(TextService textService, TransactionRepositoryFactory repoFactory)
        {
            _textService = textService;
            _repoFactory = repoFactory;
        }

        // GET: api/statements/accounts
        [HttpGet("accounts")]
        public IActionResult GetAccounts()
        {
            return Ok(DbHelper.GetAll<Account>());
        }

        // GET: api/statements/{accountId}
        [HttpGet("{accountId}")]
        public IActionResult GetTransactions(int accountId)
        {
            var account = DbHelper.GetById<Account>((long)accountId);
            if (account == null)
                return NotFound();

            var transactions = _repoFactory
                .GetRepository(account.BankName)
                .GetByAccount(accountId);

            return Ok(new
            {
                accountId,
                account.AccountNumber,
                account.BankName,
                transactions
            });
        }

        // POST: api/statements/upload
        [HttpPost("upload")]
        public async Task<IActionResult> Upload(IFormFile file, int accountId)
        {
            if (file == null || file.Length == 0)
                return BadRequest("File is empty");

            var folder = Path.Combine(Directory.GetCurrentDirectory(), "Uploads");
            Directory.CreateDirectory(folder);

            var path = Path.Combine(folder, file.FileName);

            using (var stream = new FileStream(path, FileMode.Create))
                await file.CopyToAsync(stream);

            var ext = Path.GetExtension(file.FileName).ToLowerInvariant();

            if (ext == ".txt")
            {
                _textService.ExtractText(path, accountId);
            }
            else
            {
                return BadRequest("Only TXT supported");
            }

            return Ok(new { message = "Uploaded successfully" });
        }
    }
}