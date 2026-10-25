using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Configuration;

namespace BankStatementAnalytics.Services;

public sealed class SecurityBoundaryFilter(IConfiguration configuration, IWebHostEnvironment environment, ILogger<SecurityBoundaryFilter> logger)
    : IAsyncResourceFilter, IAsyncActionFilter
{
    private static readonly SemaphoreSlim Uploads = new(1, 1);
    private static readonly SemaphoreSlim AuthenticationChanges = new(1, 1);
    public async Task OnResourceExecutionAsync(ResourceExecutingContext context, ResourceExecutionDelegate next)
    {
        var request = context.HttpContext.Request;
        var path = request.Path.Value?.ToLowerInvariant() ?? "";
        var publicHosting = configuration.GetValue<bool>("Deployment:PublicHosting");
        if (GoogleCloudMode.PublicOnly(context.HttpContext, configuration) &&
            (path is "/api/auth/login" or "/api/auth/register" or "/api/auth/setup" or "/api/auth/change-password"
                || path == "/api/auth/users" && HttpMethods.IsPost(request.Method) || path.EndsWith("/reset-password")))
        {
            context.Result = new ObjectResult(new { message = "Use Google to sign up or sign in on the cloud." }) { StatusCode = 403 };
            return;
        }
        if (publicHosting && request.IsHttps && (path == "/api/auth/setup" || path == "/api/auth/register") && Common.Framework.Auth.AuthService.NeedsSetup())
        {
            context.Result = new ObjectResult(new { message = "Create the first administrator through the private SSH setup tunnel." }) { StatusCode = 403 };
            return;
        }
        var hostFileOperation = path.Contains("browse-folders") || path.Contains("preview-path") || path.Contains("import-takeout-path")
            || path.EndsWith("import-takeout/status") || path.Contains("auto-import") && !HttpMethods.IsGet(request.Method);
        if (hostFileOperation && !context.HttpContext.User.IsInRole("Admin")
            || path.StartsWith("/api/test") && !environment.IsDevelopment()
            || publicHosting && (hostFileOperation || path.StartsWith("/api/backup") || path.StartsWith("/api/update") || path.StartsWith("/api/network-access")))
        {
            context.Result = new ObjectResult(new { message = "This operation is unavailable on the public server." }) { StatusCode = 403 };
            logger.LogWarning("SecurityBoundaryDenied {Path}", request.Path);
            return;
        }
        if (path == "/api/auth/register" && !configuration.GetValue("Security:AllowRegistration", !publicHosting))
        {
            context.Result = new ObjectResult(new { message = "Ask an administrator to create your account." }) { StatusCode = 403 };
            return;
        }
        var limit = context.HttpContext.Features.Get<IHttpMaxRequestBodySizeFeature>();
        var multipart = request.ContentType?.StartsWith("multipart/", StringComparison.OrdinalIgnoreCase) == true;
        if (publicHosting && limit is { IsReadOnly: false }) limit.MaxRequestBodySize = multipart ? 51_000_000 : 2_000_000;
        if (multipart && !await Uploads.WaitAsync(0, request.HttpContext.RequestAborted))
        {
            context.Result = new StatusCodeResult(429);
            return;
        }
        try { await next(); }
        finally { if (multipart) Uploads.Release(); }
    }

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var path = context.HttpContext.Request.Path.Value?.ToLowerInvariant() ?? "";
        if (path == "/api/split-groups/import-takeout" && !context.ActionArguments.Values.OfType<IFormFile>().Any()
            && (SecurityRuntime.PublicHosting || !context.HttpContext.User.IsInRole("Admin")))
        { context.Result = new BadRequestObjectResult(new { message = "Select a file to upload." }); return; }
        if (path.StartsWith("/api/auth/"))
        {
            var login = path == "/api/auth/login";
            foreach (var input in context.ActionArguments.Values.Where(v => v != null))
            {
                foreach (var property in input!.GetType().GetProperties())
                {
                    if (property.PropertyType != typeof(string)) continue;
                    var text = (string?)property.GetValue(input);
                    if ((property.Name is "Password" or "NewPassword") && (text == null || text.Length > 128 || !login && text.Length < 15))
                    {
                        context.Result = new BadRequestObjectResult(new { message = "New passwords must contain 15–128 characters." });
                        return;
                    }
                    if (property.Name == "CurrentPassword" && (text?.Length ?? 0) > 128)
                    { context.Result = new BadRequestObjectResult(new { message = "Password is too long." }); return; }
                    if (property.Name == "Username" && (string.IsNullOrWhiteSpace(text) || text.Length > 100 || text.Any(char.IsControl)))
                    {
                        context.Result = new BadRequestObjectResult(new { message = "Enter a valid username of at most 100 characters." });
                        return;
                    }
                    if (property.Name == "Username" && text != null) property.SetValue(input, text.Trim());
                }
            }
        }
        var serializeAuthentication = path.StartsWith("/api/auth/") && !HttpMethods.IsGet(context.HttpContext.Request.Method);
        if (serializeAuthentication && !await AuthenticationChanges.WaitAsync(TimeSpan.FromSeconds(5), context.HttpContext.RequestAborted))
        { context.Result = new StatusCodeResult(429); return; }
        try
        {
        var result = await next();
        if (path == "/api/auth/login" && result.Result is ObjectResult { StatusCode: 423 })
            result.Result = new UnauthorizedObjectResult(new { message = "Invalid username or password." });
        if (path == "/api/backup/restore" && result.Exception == null && result.Result is OkObjectResult)
        {
            var sessions = context.HttpContext.RequestServices.GetService<Common.Framework.Deployment.PersistentTicketStore>();
            if (sessions != null) await sessions.ClearAsync();
        }
        // Audit identifiers/actions, never request bodies, passwords or statement contents.
        if (context.HttpContext.User.Identity?.IsAuthenticated == true && !HttpMethods.IsGet(context.HttpContext.Request.Method))
            logger.LogInformation("SecurityAction {UserId} {Method} {Path} {Status}",
                context.HttpContext.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value,
                context.HttpContext.Request.Method, context.HttpContext.Request.Path,
                result.Exception != null ? 500 : (result.Result as ObjectResult)?.StatusCode ?? context.HttpContext.Response.StatusCode);
        }
        finally { if (serializeAuthentication) AuthenticationChanges.Release(); }
    }
}
