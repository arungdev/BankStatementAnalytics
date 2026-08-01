using Common.Framework.Data;
using Common.Framework.Web;

namespace BankStatementAnalytics.Controllers.Api
{
    /// <summary>
    /// Whole-instance backup and restore. Every endpoint (status/download/restore), the Admin-only
    /// authorization and the api/backup route are inherited from BackupApiControllerBase - this
    /// class exists so MVC discovers them in this assembly. What makes the backup this app's is
    /// registered in Program.cs as <see cref="BackupOptions"/> (product name, how the database is
    /// located, where the Uploads tree lives).
    /// </summary>
    public class BackupApiController : BackupApiControllerBase
    {
        public BackupApiController(BackupService backup) : base(backup) { }
    }
}
