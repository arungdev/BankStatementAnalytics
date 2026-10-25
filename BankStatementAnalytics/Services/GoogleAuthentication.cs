using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
namespace BankStatementAnalytics.Services;

public static class GoogleAuthentication
{
    public const string ExternalScheme = "GoogleExternal";
    public static bool IsConfigured(IConfiguration config) => !string.IsNullOrWhiteSpace(config["Authentication:Google:ClientId"])
        && !string.IsNullOrWhiteSpace(config["Authentication:Google:ClientSecret"]);
    public static void AddGoogleSignIn(this IServiceCollection services, IConfiguration config)
    {
        services.AddScoped<GoogleIdentityService>();
        if (!IsConfigured(config)) return;
        services.AddAuthentication().AddCookie(ExternalScheme, options =>
        {
            options.Cookie.Name = "BankStatementAnalytics.External";
            options.Cookie.HttpOnly = true;
            options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
            options.Cookie.SameSite = SameSiteMode.Lax;
            options.ExpireTimeSpan = TimeSpan.FromMinutes(5);
            options.SlidingExpiration = false;
        }).AddGoogle("Google", options =>
        {
            options.ClientId = config["Authentication:Google:ClientId"]!;
            options.ClientSecret = config["Authentication:Google:ClientSecret"]!;
            options.SignInScheme = ExternalScheme;
            options.CallbackPath = "/signin-google";
            options.UsePkce = true;
            options.SaveTokens = false;
            options.ClaimActions.MapJsonKey("email_verified", "email_verified");
            options.Events.OnRemoteFailure = context =>
            {
                var category = GoogleLoginFailure.Classify(context.Failure, context.Request.Query["error"]);
                var logger = context.HttpContext.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("GoogleOAuth");
                logger.LogWarning("GoogleOAuth FailureCategory={Category}", category);
                context.HandleResponse();
                context.Response.Redirect("/login?googleError=" + category);
                return Task.CompletedTask;
            };
        });
    }
}
