using System;
using System.Data.Common;
using System.IO;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Configuration;

namespace Common.Framework.Deployment;

public static class ContainerHosting
{
    // Call before building configuration, so all consumers see the same connection string.
    public static void LoadDatabasePasswordFile(
        string fileVariable = "Database__PasswordFile",
        string connectionVariable = "Database__PostgresConnectionString")
    {
        var path = Environment.GetEnvironmentVariable(fileVariable);
        if (string.IsNullOrWhiteSpace(path)) return;
        var connection = new DbConnectionStringBuilder
        {
            ConnectionString = Environment.GetEnvironmentVariable(connectionVariable) ?? ""
        };
        connection["Password"] = File.ReadAllText(path).TrimEnd('\r', '\n');
        Environment.SetEnvironmentVariable(connectionVariable, connection.ConnectionString);
    }

    // Run before cookie, origin, authentication and authorization middleware.
    public static IApplicationBuilder UseConfiguredProxy(this IApplicationBuilder app, IConfiguration config)
    {
        var address = config["Deployment:KnownProxy"];
        if (string.IsNullOrWhiteSpace(address)) return app;
        var options = new ForwardedHeadersOptions
        {
            ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
            ForwardLimit = 1
        };
        options.KnownProxies.Add(IPAddress.Parse(address));
        return app.UseForwardedHeaders(options);
    }

    // The product supplies its own readiness check; no database/provider coupling.
    public static IApplicationBuilder UseLocalReadiness(this IApplicationBuilder app,
        Func<CancellationToken, Task> check, string path = "/health") => app.Use(async (context, next) =>
    {
        if (context.Request.Path != path || context.Connection.RemoteIpAddress is not { } remote || !IPAddress.IsLoopback(remote))
        {
            await next(context);
            return;
        }
        try
        {
            await check(context.RequestAborted);
            await context.Response.WriteAsync("healthy");
        }
        catch
        {
            context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
        }
    });
}
