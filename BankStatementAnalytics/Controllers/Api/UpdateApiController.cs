using Common.Framework.Updates;
using Common.Framework.Web;
using BankStatementAnalytics.Services;
using Microsoft.AspNetCore.Mvc;

namespace BankStatementAnalytics.Controllers.Api
{
    /// <summary>
    /// Software update controller for BankStatementAnalytics.
    /// Endpoints for status inspection, check triggers, installer download, and detached upgrade execution
    /// are inherited from <see cref="UpdateApiControllerBase"/>. The installation guard blocks
    /// unsupported service-session launches before the framework changes update state.
    /// Configuration is registered in Program.cs
    /// via <see cref="UpdateOptions"/>.
    /// </summary>
    [TypeFilter(typeof(UpdateInstallationGuard))]
    public class UpdateApiController : UpdateApiControllerBase
    {
        public UpdateApiController(UpdateService updateService) : base(updateService) { }

        [HttpGet("/api/update/installation")]
        public IActionResult Installation() => Ok(new
        {
            requiresManualInstallation = UpdateInstallationGuard.RequiresManualInstallation()
        });
    }
}
