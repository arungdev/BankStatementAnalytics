using System;
using System.Security.Principal;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Common.Framework.Deployment;

public class DesktopInstallerGuard : IAsyncActionFilter
{
    private readonly string _appName;
    private readonly Func<bool> _isService;
    private readonly string _applyPath;

    public DesktopInstallerGuard(string appName, Func<bool> isService, string applyPath = "/api/update/apply")
    {
        _appName = appName;
        _isService = isService;
        _applyPath = applyPath;
    }

    public static bool RequiresManualInstallation(bool isWindowsService)
    {
        if (!OperatingSystem.IsWindows() || isWindowsService || !Environment.UserInteractive) return true;
        using var identity = WindowsIdentity.GetCurrent();
        return !new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
    }

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (HttpMethods.IsPost(context.HttpContext.Request.Method)
            && string.Equals(context.HttpContext.Request.Path.Value?.TrimEnd('/'), _applyPath, StringComparison.OrdinalIgnoreCase)
            && RequiresManualInstallation(_isService()))
        {
            context.Result = new ConflictObjectResult(new
            {
                code = "manual_install_required",
                message = OperatingSystem.IsWindows()
                    ? $"Download setup and run it as administrator on the computer hosting {_appName}. Windows services cannot display the administrator approval prompt."
                    : "Update this Linux deployment by rebuilding and recreating the Docker container. See deploy/README.md."
            });
            return;
        }
        await next();
    }
}
