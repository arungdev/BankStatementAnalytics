using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Common.Framework.Auth;
using Common.Framework.Data;
using Common.Framework.Deployment;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;

namespace BankStatementAnalytics.Services;

public static class SecureAuthentication
{
    private const string VersionClaim = "bsa.security.version";
    private const string StartedClaim = "bsa.security.started";
    private static string Fingerprint(AppUser user) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(user.PasswordHash)));
    public static IServiceCollection AddSecureSessions(this IServiceCollection services, string root)
    {
        services.AddSingleton(sp => new PersistentTicketStore(root, sp.GetRequiredService<IDataProtectionProvider>()));
        services.AddOptions<CookieAuthenticationOptions>(CookieAuthenticationDefaults.AuthenticationScheme)
            .Configure<PersistentTicketStore>((options, store) =>
            {
                options.SessionStore = store;
                options.Cookie.HttpOnly = true;
                options.Cookie.SameSite = SameSiteMode.Lax;
                options.ExpireTimeSpan = TimeSpan.FromMinutes(30);
                options.Events.OnSigningIn = async context =>
                {
                    if (!long.TryParse(context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier), out var id)) throw new InvalidOperationException("Invalid user identity.");
                    var user = await DbHelper.GetByIdAsync<AppUser>(id) ?? throw new InvalidOperationException("User no longer exists.");
                    if (!user.IsActive) throw new InvalidOperationException("Account is disabled.");
                    var identity = (ClaimsIdentity)context.Principal!.Identity!;
                    identity.AddClaim(new Claim(VersionClaim, Fingerprint(user)));
                    identity.AddClaim(new Claim(StartedClaim, DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString()));
                };
                options.Events.OnValidatePrincipal = async context =>
                {
                    if (GoogleCloudMode.PublicOnly(context.HttpContext, context.HttpContext.RequestServices.GetRequiredService<IConfiguration>()) &&
                        (context.Principal?.FindFirstValue(GoogleCloudMode.MethodClaim) != "google" || context.Principal.FindFirstValue(ClaimTypes.Role) != nameof(AppRole.User)))
                    { context.RejectPrincipal(); await context.HttpContext.SignOutAsync(); return; }
                    if (!long.TryParse(context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier), out var id)
                        || !long.TryParse(context.Principal?.FindFirstValue(StartedClaim), out var started)
                        || started > DateTimeOffset.UtcNow.ToUnixTimeSeconds()
                        || DateTimeOffset.UtcNow.ToUnixTimeSeconds() - started > 8 * 3600)
                    { context.RejectPrincipal(); await context.HttpContext.SignOutAsync(); return; }
                    var user = await DbHelper.GetByIdAsync<AppUser>(id);
                    if (user == null || !user.IsActive || context.Principal!.FindFirstValue(VersionClaim) != Fingerprint(user)
                        || context.Principal.FindFirstValue(ClaimTypes.Role) != user.Role.ToString())
                    { context.RejectPrincipal(); await context.HttpContext.SignOutAsync(); }
                };
            });
        return services;
    }
}
