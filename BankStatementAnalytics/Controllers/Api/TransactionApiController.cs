using Microsoft.AspNetCore.Mvc;
using BankStatementAnalytics.Data;
using BankStatementAnalytics.Models;
using Common.Framework.Data;
using Common.Framework.Logging;
using System;
using System.Linq;

namespace BankStatementAnalytics.Controllers.Api
{
    [ApiController]
    [Route("api/transactions")]
    public class TransactionApiController : ControllerBase
    {
        // GET: api/transactions?accountId=1
        [HttpGet]
        public IActionResult GetByAccount(int accountId)
        {
            try
            {
                var account = DbHelper.GetById<Account>((long)accountId);
                if (account == null)
                    return NotFound();

                var transactions = DbHelper
                    .GetAll<BankTransaction>()
                    .Where(x => x.AccountId == accountId && x.BankType == account.BankName.ToString())
                    .OrderByDescending(x => x.TransactionDate)
                    .ToList();

                return Ok(transactions);
            }
            catch (Exception ex)
            {
                Log.Exception(ex);
                return StatusCode(500, "Internal server error");
            }
        }
    }
}