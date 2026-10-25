using Common.Framework.Deployment;
using Microsoft.Extensions.Hosting.WindowsServices;

namespace BankStatementAnalytics.Services;

// Product identity and service detection; platform policy lives in Common.Framework.
public sealed class UpdateInstallationGuard : DesktopInstallerGuard
{
    public UpdateInstallationGuard() : base("Bank Statement Analytics", WindowsServiceHelpers.IsWindowsService) { }

    public static bool RequiresManualInstallation() =>
        DesktopInstallerGuard.RequiresManualInstallation(WindowsServiceHelpers.IsWindowsService());
}
