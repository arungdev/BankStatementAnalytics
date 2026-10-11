using BankStatementAnalytics.Controllers.Api;
using BankStatementAnalytics.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using System.Reflection;

void Check(bool condition, string description)
{
    if (!condition) throw new Exception(description);
    Console.WriteLine($"PASS: {description}");
}

var filterAttribute = typeof(UpdateApiController).GetCustomAttribute<TypeFilterAttribute>();
Check(filterAttribute?.ImplementationType == typeof(UpdateInstallationGuard), "inherited update endpoints use the installation guard");
var route = typeof(UpdateApiController).GetCustomAttribute<RouteAttribute>(inherit: true)?.Template;
Check(route?.Replace("[controller]", "UpdateApi", StringComparison.OrdinalIgnoreCase).Contains("update", StringComparison.OrdinalIgnoreCase) == true, "inherited update route is present");
var blocked = UpdateInstallationGuard.RequiresManualInstallation();
var guard = new UpdateInstallationGuard();
foreach (var (method, path, guarded) in new[] {
    ("POST", "/api/update/apply", true),
    ("POST", "/API/UPDATE/APPLY/", true),
    ("GET", "/api/update/status", false),
    ("POST", "/api/update/download", false),
    ("POST", "/api/update/check", false)
})
{
    var http = new DefaultHttpContext();
    http.Request.Method = method;
    http.Request.Path = path;
    var action = new ActionContext(http, new RouteData(), new ActionDescriptor());
    var filters = new List<IFilterMetadata>();
    var context = new ActionExecutingContext(action, filters, new Dictionary<string, object?>(), new object());
    var called = false;
    await guard.OnActionExecutionAsync(context, () => {
        called = true;
        return Task.FromResult(new ActionExecutedContext(action, filters, new object()));
    });
    Check(called == !(guarded && blocked), $"{method} {path} only launches when permitted");
    if (guarded && blocked)
    {
        Check(context.Result is ConflictObjectResult { StatusCode: 409 }, "unsupported launch reports a conflict before running the installer");
        var json = System.Text.Json.JsonSerializer.Serialize(((ConflictObjectResult)context.Result!).Value);
        Check(json.Contains("manual_install_required"), "client receives the desktop installation recovery code");
    }
}
var capability = typeof(UpdateApiController).GetMethod(nameof(UpdateApiController.Installation))!;
Check(capability.GetCustomAttribute<HttpGetAttribute>()?.Template == "/api/update/installation", "installation capability has an explicit route");
