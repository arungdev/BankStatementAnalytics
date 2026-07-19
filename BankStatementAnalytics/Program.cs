using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using BankStatementAnalytics;
using BankStatementAnalytics.Data;
using BankStatementAnalytics.Services;
using BankStatementAnalytics.Services.Parser;
using BankStatementAnalytics.Services.Pdf;
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
// ── Dev harness for tuning PDF extraction against sample statements ──────
// Usage: dotnet run -- extract-pdf <pdf-path> <HDFC|IOB|HDFCCreditCard> [password]
// Prints the normalized table (cells separated by '|') plus a parse summary,
// so PdfTableProfiles can be tuned without launching the web host.
if (args.Length >= 3 && args[0] == "extract-pdf")
{
    RunPdfExtractHarness(args);
    return;
}

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
// field so it isn't garbage-collected while the app runs. Creating a mutex in
// the Global\ namespace needs SeCreateGlobalPrivilege, which an interactive
// non-elevated dev process lacks — so treat failure as non-fatal (the mutex is
// only a convenience for the installer, not required to run).
try
{
    AppMutexHolder.Handle = new Mutex(false, "Global\\BankStatementAnalytics.exe");
}
catch (UnauthorizedAccessException ex)
{
    Log.Info($"Could not create global installer mutex (continuing without it): {ex.Message}");
}
// MVC
builder.Services.AddControllersWithViews();

// Services
builder.Services.AddSingleton<PdfStatementReader>(); // stateless
builder.Services.AddScoped<TextService>();
builder.Services.AddScoped<StatementImportService>();
// Watch-folder auto-import sweeps. Registered as a singleton first so controllers
// can resolve the same instance and call TriggerSweep ("Import now").
builder.Services.AddSingleton<WatchFolderImportService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<WatchFolderImportService>());
builder.Services.AddScoped<TransactionRepositoryFactory>();
builder.Services.AddScoped<CounterPartyService>();
builder.Services.AddScoped<RecurringBillService>();
builder.Services.AddScoped<DepositService>();
builder.Services.AddScoped<ReportService>();
builder.Services.AddScoped<ReportPdfService>();
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
    options.FullAccessRoles = new[] { nameof(AppRole.Admin), nameof(AppRole.User) };
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

static void RunPdfExtractHarness(string[] args)
{
    try { Log.Initialize("log4net.config"); } catch { /* console-only run */ }

    var pdfPath = args[1];
    if (!File.Exists(pdfPath))
    {
        // dotnet run executes with the project directory as cwd - prefer absolute paths.
        Console.WriteLine($"File not found: {Path.GetFullPath(pdfPath)}");
        Environment.ExitCode = 1;
        return;
    }
    // Bank "RAW" dumps every visual row as plain text instead of running a profile.
    var rawDump = string.Equals(args[2], "RAW", StringComparison.OrdinalIgnoreCase);
    var bank = rawDump
        ? default(BankStatementAnalytics.EnumClass.Bank)
        : Enum.Parse<BankStatementAnalytics.EnumClass.Bank>(args[2], ignoreCase: true);
    var password = args.Length > 3 && args[3] != "--cells" ? args[3] : null;

    try
    {
        var reader = new PdfStatementReader();

        if (rawDump)
        {
            foreach (var row in reader.DumpVisualRows(File.ReadAllBytes(pdfPath), password))
                Console.WriteLine(row);
            return;
        }

        if (args.Contains("--cells"))
        {
            foreach (var row in reader.DumpAssignedCells(File.ReadAllBytes(pdfPath), bank, password))
                Console.WriteLine(row);
            return;
        }

        var normalized = reader.ExtractNormalizedText(File.ReadAllBytes(pdfPath), bank, password);

        Console.WriteLine("── Normalized table ────────────────────────────────────────");
        Console.WriteLine(normalized.Replace(PdfStatementReader.CellSeparator, '|'));

        IBankParser parser = bank switch
        {
            BankStatementAnalytics.EnumClass.Bank.HDFC => new HdfcPdfParser(),
            BankStatementAnalytics.EnumClass.Bank.IOB => new IobPdfParser(),
            _ => new HdfcCreditCardPdfParser(),
        };
        // accountId 0: harness only inspects parse output, nothing is persisted.
        var transactions = parser.Parse(normalized, 0).ToList();

        Console.WriteLine($"── Parsed {transactions.Count} transaction(s) ──────────────");
        foreach (var t in transactions.Take(3).Concat(transactions.TakeLast(Math.Min(3, Math.Max(0, transactions.Count - 3)))))
            Console.WriteLine($"{t.TransactionDate:dd/MM/yyyy}  {t.TransactionType}  {t.Amount,12:0.00}  bal {t.Balance,12:0.00}  {t.Description}");
        Console.WriteLine($"Totals: debit {transactions.Sum(t => t.Debit):0.00}, credit {transactions.Sum(t => t.Credit):0.00}");

        // Rows without a merchant won't resolve in the app — the usual sign of a
        // remark format the parser doesn't know yet.
        var unresolved = transactions
            .Where(t => string.IsNullOrWhiteSpace(t.PendingCounterPartyName))
            .ToList();
        Console.WriteLine($"Unresolved merchant: {unresolved.Count} row(s)");
        foreach (var t in unresolved.Take(10))
            Console.WriteLine($"  {t.TransactionDate:dd/MM/yyyy}  {t.TransactionType}  {t.Amount,10:0.00}  {t.Description}");

        // Credit card statements also carry a summary block — show what the
        // extractor found so its regexes can be tuned alongside the table profile.
        if (bank == BankStatementAnalytics.EnumClass.Bank.HDFCCreditCard)
        {
            var s = HdfcCcSummaryExtractor.Extract(reader, File.ReadAllBytes(pdfPath), password);
            Console.WriteLine("── Statement summary ───────────────────────────────────────");
            Console.WriteLine($"Statement date : {s.StatementDate:dd/MM/yyyy}");
            Console.WriteLine($"Billing period : {s.PeriodStart:dd/MM/yyyy} - {s.PeriodEnd:dd/MM/yyyy}");
            Console.WriteLine($"Total due      : {s.TotalDue:0.00}");
            Console.WriteLine($"Minimum due    : {s.MinimumDue:0.00}");
            Console.WriteLine($"Due date       : {s.PaymentDueDate:dd/MM/yyyy}");
            Console.WriteLine($"Credit limit   : {s.CreditLimit:0.00} (available {s.AvailableCreditLimit:0.00})");
            Console.WriteLine($"Reward points  : {s.RewardPointsBalance}");
        }
    }
    catch (PdfExtractionException pex)
    {
        Console.WriteLine($"EXTRACTION FAILED ({pex.GetType().Name}): {pex.Message}");
        Environment.ExitCode = 1;
    }
}

internal static class AppMutexHolder
{
    public static Mutex? Handle;
}