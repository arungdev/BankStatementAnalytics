using Microsoft.AspNetCore.Mvc;
using Common.Framework.Web;
using BankStatementAnalytics.Services;

namespace BankStatementAnalytics.Controllers.Api
{
    [ApiController]
    [Route("api/deposits")]
    public class DepositsApiController : TenantControllerBase
    {
        private readonly DepositService _service;

        public DepositsApiController(DepositService service)
        {
            _service = service;
        }

        // GET: api/deposits — RD/FD investments detected from the user's transaction history,
        // with roll-up totals (total invested, monthly RD commitment, active FD count).
        [HttpGet]
        public IActionResult GetSummary()
        {
            return Ok(_service.GetSummary(CurrentUserId));
        }
    }
}
