using Microsoft.Extensions.DependencyInjection.Extensions;
using BankStatementAnalytics;
using BankStatementAnalytics.Data;
using BankStatementAnalytics.Services;
using BankStatementAnalytics.Services.Parser;
using System.Text.Json.Serialization;
using Common.Framework.Logging;
using System;

var builder = WebApplication.CreateBuilder(args);

Log.Initialize("log4net.config");
Log.Info(AppContext.BaseDirectory);
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

// Global Error Logging Middleware
app.Use(async (context, next) =>
{
    try
    {
        await next();
    }
    catch (Exception ex)
    {
        Log.Error($"Unhandled API exception: {context.Request.Method} {context.Request.Path}", ex);
        throw;
    }
});

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