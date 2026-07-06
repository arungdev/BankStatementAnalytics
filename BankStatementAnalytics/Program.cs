using Microsoft.Extensions.DependencyInjection.Extensions;
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

var builder = WebApplication.CreateBuilder(args);

Log.Initialize("log4net.config");
Log.Info(AppContext.BaseDirectory);

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
    "http://localhost:5008",
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
var keysDirectory = Path.Combine(Common.Framework.AppPaths.ResolveAppDirectory(), "Data", "Keys");
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
app.MapFallbackToFile("index.html").AllowAnonymous();

app.Run();

internal static class AppMutexHolder
{
    public static Mutex? Handle;
}