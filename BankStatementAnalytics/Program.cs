using Microsoft.Extensions.DependencyInjection.Extensions;
using BankStatementAnalytics;
using BankStatementAnalytics.Data;
using BankStatementAnalytics.Services;
using BankStatementAnalytics.Services.Parser;
using System.Text.Json.Serialization;
using Common.Framework.Logging;
using Common.Framework.Web;
using System;
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
builder.Services.AddCors(options =>
{
    options.AddPolicy("React", policy =>
    {
        policy.WithOrigins(
                "http://localhost:5173",
                "http://localhost:5174",
                "http://localhost:5175"
            )
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});
builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.ReferenceHandler = ReferenceHandler.IgnoreCycles;
        options.JsonSerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter());
    });


var app = builder.Build();

app.UseCors("React");

// Global exception handling: logs unhandled exceptions and returns a 500 response.
app.UseApiExceptionHandling();

// Initialize NHibernate
_ = NHibernateHelper.SessionFactory;

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Home/Error");
    app.UseHsts();

    // Move HTTPS redirection here so it doesn't break local HTTP testing
    app.UseHttpsRedirection();
}

app.UseStaticFiles();

app.UseRouting();

app.UseAuthorization();

// Map API controllers that use [Route("...")] attributes
app.MapControllers();

// Forward any requests that don't match an API endpoint to the React frontend
app.MapFallbackToFile("index.html");

app.Run();

internal static class AppMutexHolder
{
    public static Mutex? Handle;
}