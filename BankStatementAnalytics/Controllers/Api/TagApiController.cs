using BankStatementAnalytics.Models;
using Common.Framework.Data;
using Common.Framework.Web;
using Microsoft.AspNetCore.Mvc;

namespace BankStatementAnalytics.Controllers.Api
{
    [ApiController]
    [Route("api/tags")]
    public class TagApiController : TenantControllerBase
    {
        [HttpGet]
        public IActionResult GetAll()
        {
            var tags = DbHelper.GetAll<Tag>()
                .Where(t => t.OwnerUserId == CurrentUserId)
                .OrderBy(t => t.Name)
                .Select(t => new { t.Id, t.Name })
                .ToList();
            return Ok(tags);
        }
    }
}
