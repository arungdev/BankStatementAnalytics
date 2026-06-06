using Microsoft.AspNetCore.Mvc;
using BankStatementAnalytics.Data;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Controllers.Api
{
    [ApiController]
    [Route("api/accounts")]
    public class AccountApiController : ControllerBase
    {
        // GET: api/accounts
        [HttpGet]
        public IActionResult GetAll()
        {
            var accounts = DbHelper.GetAll<Account>()
                .Select(a => new { a.Id, a.AccountHolderName, a.BankName, MaskedAccountNumber = a.MaskedAccountNumber });
            return Ok(accounts);
        }

        // GET: api/accounts/{id}
        [HttpGet("{id}")]
        public IActionResult GetById(int id)
        {
            var account = DbHelper.GetById<Account>((long)id);
            if (account == null)
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
            account.AccountNumber = Account.Mask(account.AccountNumber);

            await DbHelper.SaveAsync(account);

            var dto = new { account.Id, account.AccountHolderName, account.BankName, MaskedAccountNumber = account.MaskedAccountNumber };
            return CreatedAtAction(nameof(GetById), new { id = account.Id }, dto);
        }
    }
}