using Microsoft.AspNetCore.Mvc;
using Common.Framework.Web;
using BankStatementAnalytics.Services;

namespace BankStatementAnalytics.Controllers.Api
{
    [ApiController]
    [Route("api/anomalies")]
    public class AnomaliesApiController : TenantControllerBase
    {
        private readonly AnomalyDetectionService _service;

        public AnomaliesApiController(AnomalyDetectionService service)
        {
            _service = service;
        }

        // GET: api/anomalies
        [HttpGet]
        public IActionResult GetAnomalies([FromQuery] int lookbackDays = 90)
        {
            var alerts = _service.DetectAnomalies(CurrentUserId, lookbackDays);
            return Ok(alerts);
        }
    }
}
