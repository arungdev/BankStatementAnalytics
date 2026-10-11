using System.Security.Principal;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Hosting.WindowsServices;

namespace BankStatementAnalytics.Services;

/// <summary>
/// A browser's administrator login does not elevate the Windows service. Inno Setup
/// needs an elevated desktop token, and a service cannot display its UAC prompt.
/// Keep the framework from starting an installer that can never finish in that session.
/// </summary>
public sealed class UpdateInstallationGuard : IAsyncActionFilter
{
    public static bool RequiresManualInstallation()
    {
        if (!OperatingSystem.IsWindows()) return true;
        if (WindowsServiceHelpers.IsWindowsService() || !Environment.UserInteractive) return true;
        using var identity = WindowsIdentity.GetCurrent();
        return !new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
    }

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (HttpMethods.IsPost(context.HttpContext.Request.Method)
            && context.HttpContext.Request.Path.Value?.TrimEnd('/').Equals(
                "/api/update/apply", StringComparison.OrdinalIgnoreCase) == true
            && RequiresManualInstallation())
        {
            context.Result = new ConflictObjectResult(new
            {
                code = "manual_install_required",
                message = "Download setup and run it as administrator on the computer hosting Bank Statement Analytics. Windows services cannot display the administrator approval prompt."
            });
            return;
        }

        await next();
    }
}
