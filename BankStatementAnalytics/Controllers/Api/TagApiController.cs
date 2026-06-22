using BankStatementAnalytics.Models;
using Common.Framework.Data;
using Microsoft.AspNetCore.Mvc;

namespace BankStatementAnalytics.Controllers.Api
{
    [ApiController]
    [Route("api/tags")]
    public class TagApiController : ControllerBase
    {
        [HttpGet]
        public IActionResult GetAll()
        {
            var tags = DbHelper.GetAll<Tag>()
                .OrderBy(t => t.Name)
                .Select(t => new { t.Id, t.Name })
                .ToList();
            return Ok(tags);
        }
    }
}
