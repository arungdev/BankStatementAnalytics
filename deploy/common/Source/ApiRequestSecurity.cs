using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

namespace Common.Framework.Deployment;

public static class ApiRequestSecurity
{
    public static IApplicationBuilder UseStrictApiOrigins(this IApplicationBuilder app,
        IReadOnlyCollection<string> developmentOrigins, bool development) => app.Use(async (context, next) =>
    {
        if (context.Request.Path.StartsWithSegments("/api"))
        {
            context.Response.Headers.CacheControl = "no-store";
            context.Response.Headers["Pragma"] = "no-cache";
            context.Response.Headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
            if (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method) && !HttpMethods.IsOptions(context.Request.Method))
            {
                var origin = context.Request.Headers.Origin.ToString();
                var self = $"{context.Request.Scheme}://{context.Request.Host}";
                var permitted = string.IsNullOrEmpty(origin) || string.Equals(origin, self, StringComparison.OrdinalIgnoreCase);
                if (development && !string.IsNullOrEmpty(origin))
                    foreach (var allowed in developmentOrigins) permitted |= string.Equals(origin, allowed, StringComparison.OrdinalIgnoreCase);
                if (!permitted || string.Equals(context.Request.Headers["Sec-Fetch-Site"], "cross-site", StringComparison.OrdinalIgnoreCase))
                {
                    context.Response.StatusCode = StatusCodes.Status403Forbidden;
                    await context.Response.WriteAsJsonAsync(new { message = "Request origin is not allowed." });
                    return;
                }
            }
        }
        await next(context);
    });
}
