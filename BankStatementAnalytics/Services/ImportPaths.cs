namespace BankStatementAnalytics.Services;

internal static class ImportPaths
{
    public static string GPayDirectory =>
        Environment.GetEnvironmentVariable("GPAY_IMPORT_DIRECTORY")
        ?? (OperatingSystem.IsWindows() ? @"D:\BankStatements\Gpay"
            : Path.Combine(Common.Framework.AppPaths.ResolveWritableAppDataDirectory(), "Uploads", "Gpay"));

    public static string TakeoutFile =>
        Environment.GetEnvironmentVariable("GPAY_TAKEOUT_FILE")
        ?? Path.Combine(GPayDirectory, "takeout-20261003T045601Z-1-001.zip");
}
