using Microsoft.Extensions.Configuration;
namespace BankStatementAnalytics.Services;

// Process configuration only; never stores user data or identity.
public static class SecurityRuntime
{
    private static IConfiguration? _configuration;
    public static void Configure(IConfiguration configuration) => _configuration = configuration;
    public static bool PublicHosting => _configuration?.GetValue<bool>("Deployment:PublicHosting")
        ?? string.Equals(Environment.GetEnvironmentVariable("Deployment__PublicHosting"), "true", StringComparison.OrdinalIgnoreCase);
}
