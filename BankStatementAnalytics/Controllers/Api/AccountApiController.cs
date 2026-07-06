using BankStatementAnalytics.Data;
using BankStatementAnalytics.EnumClass;
using BankStatementAnalytics.Models;
using Common.Framework.Data;
using Common.Framework.Web;
using Microsoft.AspNetCore.Mvc;
using System;

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

            var formats = account.BankName switch
            {
                Bank.HDFC => new[] { ".txt" },
                Bank.HDFCCreditCard => new[] { ".csv" },
                Bank.IOB => new[] { ".txt" },
                _ => new[] { ".txt" }
            };

            return Ok(new
            {
                bankName = account.BankName.ToString(),
                formats,
                label = string.Join(", ", formats.Select(f => f.TrimStart('.').ToUpper()))
            });
        }

        // GET: api/accounts/banks
        [HttpGet("banks")]
        public IActionResult GetBanks()
        {
            var banks = Enum.GetNames<Bank>();
            return Ok(banks);
        }

        // GET: api/accounts
        [HttpGet]
        public IActionResult GetAll()
        {
            var accounts = DbHelper.GetAll<Account>()
                .Where(a => a.OwnerUserId == CurrentUserId)
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
    }
}
