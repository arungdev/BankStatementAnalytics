using Microsoft.AspNetCore.Mvc;
using Common.Framework.Web;
using BankStatementAnalytics.Services;
using System.Threading.Tasks;

namespace BankStatementAnalytics.Controllers.Api
{
    [ApiController]
    [Route("api/duplicates")]
    public class DuplicatesApiController : TenantControllerBase
    {
        private readonly DuplicateDetectionService _service;

        public DuplicatesApiController(DuplicateDetectionService service)
        {
            _service = service;
        }

        // GET: api/duplicates — list potential duplicate charges detected in last 90 days
        [HttpGet]
        public IActionResult GetDuplicates([FromQuery] int lookbackDays = 90)
        {
            var duplicates = _service.DetectDuplicates(CurrentUserId, lookbackDays);
            return Ok(duplicates);
        }
    }
}
