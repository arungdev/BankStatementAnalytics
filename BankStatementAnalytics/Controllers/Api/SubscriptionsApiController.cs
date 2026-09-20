using Microsoft.AspNetCore.Mvc;
using Common.Framework.Web;
using BankStatementAnalytics.Services;

namespace BankStatementAnalytics.Controllers.Api
{
    [ApiController]
    [Route("api/subscriptions")]
    public class SubscriptionsApiController : TenantControllerBase
    {
        private readonly SubscriptionService _service;

        public SubscriptionsApiController(SubscriptionService service)
        {
            _service = service;
        }

        // GET: api/subscriptions
        [HttpGet]
        public IActionResult GetSubscriptions()
        {
            var result = _service.GetSubscriptions(CurrentUserId);
            return Ok(result);
        }
    }
}
