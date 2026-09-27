using Common.Framework.Network;
using Microsoft.AspNetCore.Mvc;

namespace BankStatementAnalytics.Controllers.Api
{
    /// <summary>
    /// Network access status and toggle endpoints. Inherited from <see cref="NetworkApiControllerBase"/>
    /// in Common.Framework so routes are discovered by MVC.
    /// </summary>
    public class NetworkAccessApiController : NetworkApiControllerBase
    {
        public NetworkAccessApiController(NetworkAccessService networkService) : base(networkService)
        {
        }
    }
}
