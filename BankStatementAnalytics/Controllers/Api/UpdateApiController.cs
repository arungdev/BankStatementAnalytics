using Common.Framework.Updates;
using Common.Framework.Web;

namespace BankStatementAnalytics.Controllers.Api
{
    /// <summary>
    /// Software update controller for BankStatementAnalytics.
    /// Endpoints for status inspection, check triggers, installer download, and detached upgrade execution
    /// are inherited from <see cref="UpdateApiControllerBase"/>. Configuration is registered in Program.cs
    /// via <see cref="UpdateOptions"/>.
    /// </summary>
    public class UpdateApiController : UpdateApiControllerBase
    {
        public UpdateApiController(UpdateService updateService) : base(updateService) { }
    }
}
