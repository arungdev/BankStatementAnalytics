namespace BankStatementAnalytics.Services;

public static class GoogleCloudMode
{
    public const string MethodClaim = "bsa.login.method";
    public static bool Enabled(IConfiguration config) => config.GetValue<bool>("Deployment:PublicHosting");
    public static bool PublicOnly(HttpContext context, IConfiguration config) => Enabled(config) && context.Request.IsHttps;
}
