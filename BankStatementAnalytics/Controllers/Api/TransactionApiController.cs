using Microsoft.AspNetCore.Mvc;
using BankStatementAnalytics.Data;
using BankStatementAnalytics.Models;

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
            var account = DbHelper.GetById<Account>((long)accountId);
            if (account == null)
                return NotFound();

            // fallback simple version
            var transactions = DbHelper
                .GetAll<IobTransaction>()
                .Where(x => x.AccountId == accountId)
                .OrderByDescending(x => x.TransactionDate)
                .ToList();

            return Ok(transactions);
        }
    }
}