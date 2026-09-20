using Microsoft.AspNetCore.Mvc;
using Common.Framework.Web;
using BankStatementAnalytics.Services;
using System;

namespace BankStatementAnalytics.Controllers.Api
{
    [ApiController]
    [Route("api/forecast")]
    public class ForecastApiController : TenantControllerBase
    {
        private readonly ForecastService _service;

        public ForecastApiController(ForecastService service)
        {
            _service = service;
        }

        // GET: api/forecast?accountId=1&accountIds=1,2&days=60
        [HttpGet]
        public IActionResult GetForecast(
            [FromQuery] int? accountId = null,
            [FromQuery] string? accountIds = null,
            [FromQuery] int days = 60)
        {
            var result = _service.GenerateForecast(CurrentUserId, accountId, accountIds, days);
            return Ok(result);
        }
    }
}
