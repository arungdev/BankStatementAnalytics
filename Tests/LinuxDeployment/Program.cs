using BankStatementAnalytics.Services;
using Common.Framework.Deployment;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using System.Net;

void Check(bool condition, string message)
{
    if (!condition) throw new Exception(message);
    Console.WriteLine($"PASS: {message}");
}

var secretPath = Path.GetTempFileName();
var oldFile = Environment.GetEnvironmentVariable("DEPLOY_TEST_FILE");
var oldConnection = Environment.GetEnvironmentVariable("DEPLOY_TEST_CONNECTION");
try
{
    File.WriteAllText(secretPath, "test;quoted\"password\r\n");
    Environment.SetEnvironmentVariable("DEPLOY_TEST_FILE", secretPath);
    Environment.SetEnvironmentVariable("DEPLOY_TEST_CONNECTION", "Host=localhost;Database=synthetic");
    ContainerHosting.LoadDatabasePasswordFile("DEPLOY_TEST_FILE", "DEPLOY_TEST_CONNECTION");
    var parsed = new Npgsql.NpgsqlConnectionStringBuilder(Environment.GetEnvironmentVariable("DEPLOY_TEST_CONNECTION"));
    Check(parsed.Password == "test;quoted\"password", "shared secret loader escapes connection strings and trims file newlines");
}
finally
{
    File.Delete(secretPath);
    Environment.SetEnvironmentVariable("DEPLOY_TEST_FILE", oldFile);
    Environment.SetEnvironmentVariable("DEPLOY_TEST_CONNECTION", oldConnection);
}

using var services = new ServiceCollection().AddLogging().BuildServiceProvider();
var fileRoot = Path.Combine(Path.GetTempPath(), "common-store-root");
var fileStore = new RootedFileStore(fileRoot);
Check(fileStore.ResolvePath("Documents/test.txt") == Path.Combine(fileRoot, "Documents", "test.txt"), "shared file store resolves product-independent relative paths");
foreach (var invalid in new[] { "../outside.txt", Path.Combine(Path.GetTempPath(), "absolute.txt") })
{
    var rejected = false;
    try { fileStore.ResolvePath(invalid); } catch (ArgumentException) { rejected = true; }
    Check(rejected, "shared file store rejects paths outside its root");
}
if (!OperatingSystem.IsWindows())
{
    var rejected = false;
    try { fileStore.ResolvePath("../COMMON-STORE-ROOT/test.txt"); } catch (ArgumentException) { rejected = true; }
    Check(rejected, "Linux file confinement respects case-sensitive directories");
}
foreach (var (remote, fail, expected) in new[] { ("127.0.0.1", false, 200), ("::1", true, 503), ("192.0.2.9", false, 404) })
{
    var pipeline = new ApplicationBuilder(services);
    var checkedReadiness = false;
    pipeline.UseLocalReadiness(ct =>
    {
        checkedReadiness = true;
        return fail ? Task.FromException(new Exception("synthetic failure")) : Task.CompletedTask;
    });
    var context = new DefaultHttpContext();
    context.Connection.RemoteIpAddress = IPAddress.Parse(remote);
    context.Request.Path = "/health";
    context.Response.Body = new MemoryStream();
    await pipeline.Build()(context);
    Check(context.Response.StatusCode == expected && checkedReadiness == (expected != 404), $"shared readiness handles local/remote/failure: {remote}, {expected}");
}

foreach (var trusted in new[] { true, false })
{
    var pipeline = new ApplicationBuilder(services);
    var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> { ["Deployment:KnownProxy"] = "192.0.2.2" }).Build();
    pipeline.UseConfiguredProxy(configuration);
    pipeline.Run(context => Task.CompletedTask);
    var context = new DefaultHttpContext();
    context.Connection.RemoteIpAddress = IPAddress.Parse(trusted ? "192.0.2.2" : "192.0.2.3");
    context.Request.Scheme = "http";
    context.Request.Headers["X-Forwarded-Proto"] = "https";
    context.Request.Headers["X-Forwarded-For"] = "198.51.100.8";
    await pipeline.Build()(context);
    Check(context.Request.Scheme == (trusted ? "https" : "http"), $"shared proxy rejects untrusted forwarded headers: trusted={trusted}");
}

var report = new ReportView
{
    Type = "monthly",
    Label = "Linux deployment ₹ report",
    StartDate = new DateTime(2026, 1, 1),
    EndDate = new DateTime(2026, 1, 31),
    Summary = new ReportSummary { TotalIncome = 2000, TotalSpends = 500, Net = 1500, TransactionCount = 2 },
    ByCategory = new() { new ReportGroupTotal { Name = "Bills", Total = 500, Count = 1 } }
};
var pdf = new ReportPdfService().Render(report, "Test account");
if (pdf.Length < 1000 || System.Text.Encoding.ASCII.GetString(pdf, 0, 5) != "%PDF-")
    throw new Exception("Report export did not produce a PDF.");
Console.WriteLine($"PASS: report PDF rendered with platform fonts ({pdf.Length} bytes)");
