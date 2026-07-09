using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using BankStatementAnalytics;
using BankStatementAnalytics.Data;
using BankStatementAnalytics.Services;
using BankStatementAnalytics.Services.Parser;
using System.Text.Json.Serialization;
using Common.Framework.Auth;
using Common.Framework.Logging;
using Common.Framework.Web;
using System;
using System.IO;
using System.Threading;

// Resolve the true executable directory up front. For a single-file, self-extracting exe -
// especially when run as a Windows service - the host's content root and AppContext.BaseDirectory
// point at a temp extraction folder, not the real install dir, so the host can't find the
// appsettings.json / wwwroot that sit next to the actual exe (it would ignore "Urls" and 404 the
// SPA). ResolveAppDirectory uses the process MainModule path, which survives self-extraction - the
// same trick NHibernateHelper uses for the DB path.
var exeDir = Common.Framework.AppPaths.ResolveAppDirectory();
var envName = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Production";
var exeConfig = new ConfigurationBuilder()
    .SetBasePath(exeDir)
    .AddJsonFile("appsettings.json", optional: true)
    .AddJsonFile($"appsettings.{envName}.json", optional: true)
    .AddEnvironmentVariables()
    .Build();

// Apply the configured bind URL via ASPNETCORE_URLS BEFORE the host is built. builder.WebHost.UseUrls
// / UseWebRoot throw NotSupportedException in the WebApplication model once host config is fixed (and
// UseWindowsService fixes it), so they can't be set after CreateBuilder - the host reads this env var
// at build time instead. Skip if something already set it (e.g. launchSettings in dev).
var configuredUrls = exeConfig["Urls"];
if (!string.IsNullOrWhiteSpace(configuredUrls) && string.IsNullOrEmpty(Environment.GetEnvironmentVariable("ASPNETCORE_URLS")))
    Environment.SetEnvironmentVariable("ASPNETCORE_URLS", configuredUrls);

var builder = WebApplication.CreateBuilder(args);

// Run as a Windows service when launched by the SCM (see Installer/install-service.bat).
// This is a no-op when the exe is started interactively, so the desktop shortcut still works.
builder.Host.UseWindowsService(options =>
{
    options.ServiceName = "BankStatementAnalytics";
});

// Serve the SPA from the real wwwroot next to the exe rather than the host's default web root
// (which points at the temp extraction folder for a single-file service). Applied explicitly to
// the static-file middleware below, since the host web root can't be changed after CreateBuilder.
var exeWebRoot = Path.Combine(exeDir, "wwwroot");
var spaFileProvider = Directory.Exists(exeWebRoot) ? new PhysicalFileProvider(exeWebRoot) : null;

Log.Initialize("log4net.config");
Log.Info($"Host startup: environment='{builder.Environment.EnvironmentName}', isService={Microsoft.Extensions.Hosting.WindowsServices.WindowsServiceHelpers.IsWindowsService()}.");
Log.Info($"Host startup: AppContext.BaseDirectory='{AppContext.BaseDirectory}', resolved exeDir='{exeDir}'.");
Log.Info($"Host startup: writable data root='{Common.Framework.AppPaths.ResolveWritableAppDataDirectory()}'.");
Log.Info($"Host startup: bind URLs='{configuredUrls ?? "(default)"}', webRoot='{(spaFileProvider != null ? exeWebRoot : "(not found - SPA not served)")}'.");

// Named mutex so the Inno Setup installer (AppMutex) can detect a running
// instance and prompt to close it before install/uninstall. Held in a static
// field so it isn't garbage-collected while the app runs.
AppMutexHolder.Handle = new Mutex(false, "Global\\BankStatementAnalytics.exe");
// MVC
builder.Services.AddControllersWithViews();

// Services
builder.Services.AddScoped<TextService>();
builder.Services.AddScoped<TransactionRepositoryFactory>();
builder.Services.AddScoped<CounterPartyService>();
builder.Services.AddScoped<RecurringBillService>();
builder.Services.AddScoped<DepositService>();
// ── Auto-register all parsers from registry ──────────────────────────────
foreach (var config in BankParserRegistry.Parsers)
{
    builder.Services.AddScoped(config.ParserType);
}

// Defined once, reused by both CORS and the RBAC/CSRF origin check below.
var allowedOrigins = new[]
{
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://localhost:5080",
};

builder.Services.AddCors(options =>
{
    options.AddPolicy("React", policy =>
    {
        policy.AllowAnyHeader().AllowAnyMethod().AllowCredentials();

        if (builder.Environment.IsDevelopment())
            // Any localhost port in dev, so the Vite port doesn't need enumerating.
            policy.SetIsOriginAllowed(o => Uri.TryCreate(o, UriKind.Absolute, out var u) && u.IsLoopback);
        else
            policy.WithOrigins(allowedOrigins);
    });
});
builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.ReferenceHandler = ReferenceHandler.IgnoreCycles;
        options.JsonSerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter());
    });

// Cookie session auth + global "must be authenticated" fallback policy + Data Protection
// keys persisted next to the DB (survives single-file extraction and app restarts).
var keysDirectory = Path.Combine(Common.Framework.AppPaths.ResolveWritableAppDataDirectory(), "Data", "Keys");
builder.Services.AddCookieSessionAuth(builder.Environment, keysDirectory, cookieName: "BankStatementAnalytics.Auth");
builder.Services.AddAuthRateLimiting();

var app = builder.Build();

app.UseCors("React");
app.UseSecurityHeaders();

// Global exception handling: logs unhandled exceptions and returns a 500 response.
app.UseApiExceptionHandling();

// Initialize NHibernate
_ = NHibernateHelper.SessionFactory;

// Gracefully stop the embedded PostgreSQL process (if it was started) on shutdown.
app.Lifetime.ApplicationStopping.Register(() => Common.Framework.Data.EmbeddedPostgresManager.Stop());

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Home/Error");
    app.UseHsts();

    // Move HTTPS redirection here so it doesn't break local HTTP testing
    app.UseHttpsRedirection();
}

// Serve wwwroot from the resolved exe directory (spaFileProvider) when available - see the exeDir
// note at the top; falls back to the host default web root in dev when it wasn't overridden.
if (spaFileProvider != null)
    app.UseStaticFiles(new StaticFileOptions { FileProvider = spaFileProvider });
else
    app.UseStaticFiles();

app.UseRouting();

app.UseRateLimiter();

app.UseAuthentication();

app.UseRoleGate(options =>
{
    options.FullAccessRole = nameof(AppRole.Admin);
    options.AllowedOrigins = allowedOrigins;
    // In dev the SPA runs on a localhost port that varies (Vite); accept any loopback
    // origin so uploads/mutations aren't blocked. Production stays strict.
    options.AllowLoopbackOrigins = app.Environment.IsDevelopment();
});

app.UseAuthorization();

// Map API controllers that use [Route("...")] attributes
app.MapControllers();

// Forward any requests that don't match an API endpoint to the React frontend.
// Must be anonymous: the SPA shell has to load so its own login/setup screens can
// run and call the [AllowAnonymous] /api/auth/* endpoints. Without this, the global
// RequireAuthenticatedUser fallback policy 401s index.html and the app never boots.
if (spaFileProvider != null)
    app.MapFallbackToFile("index.html", new StaticFileOptions { FileProvider = spaFileProvider }).AllowAnonymous();
else
    app.MapFallbackToFile("index.html").AllowAnonymous();

app.Run();

internal static class AppMutexHolder
{
    public static Mutex? Handle;
}