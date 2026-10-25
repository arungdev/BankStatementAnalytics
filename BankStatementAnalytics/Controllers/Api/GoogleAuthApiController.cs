using System.Security.Claims;
using BankStatementAnalytics.Services;
using Common.Framework.Auth;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace BankStatementAnalytics.Controllers.Api;

[ApiController]
[Route("api/auth")]
public sealed class GoogleAuthApiController(IConfiguration config, IWebHostEnvironment environment, GoogleIdentityService identities) : ControllerBase
{
    [HttpGet("options"), AllowAnonymous]
    public IActionResult Options() => Ok(new
    {
        google = GoogleAuthentication.IsConfigured(config),
        cloudGoogleOnly = GoogleCloudMode.Enabled(config),
        googleOnly = GoogleCloudMode.PublicOnly(HttpContext, config),
        allowRegistration = config.GetValue("Security:AllowRegistration", !SecurityRuntime.PublicHosting),
        retainOriginalUploads = !SecurityRuntime.PublicHosting
    });

    [HttpGet("google/start"), AllowAnonymous, EnableRateLimiting("auth")]
    public IActionResult Start()
    {
        if (!GoogleAuthentication.IsConfigured(config)) return NotFound();
        if (!Request.IsHttps && !environment.IsDevelopment()) return BadRequest("Use HTTPS to sign in with Google.");
        if (!GoogleCloudMode.Enabled(config) && AuthService.NeedsSetup()) return StatusCode(403, new { message = "Complete administrator setup first." });
        return Challenge(new AuthenticationProperties { RedirectUri = "/api/auth/google/complete" }, "Google");
    }

    [HttpPost("google/link"), Authorize, EnableRateLimiting("auth")]
    public IActionResult Link()
    {
        if (GoogleCloudMode.Enabled(config)) return NotFound();
        if (!GoogleAuthentication.IsConfigured(config)) return NotFound();
        if (!Request.IsHttps && !environment.IsDevelopment()) return BadRequest("Use HTTPS to link Google.");
        if (!long.TryParse(User.FindFirstValue("bsa.security.started"), out var started) || DateTimeOffset.UtcNow.ToUnixTimeSeconds() - started > 600)
            return StatusCode(403, new { message = "Sign in again before linking a Google account." });
        var properties = new AuthenticationProperties { RedirectUri = "/api/auth/google/complete" };
        properties.Items["link_user"] = User.FindFirstValue(ClaimTypes.NameIdentifier);
        return Challenge(properties, "Google");
    }

    [HttpGet("google/complete"), AllowAnonymous, EnableRateLimiting("auth")]
    public async Task<IActionResult> Complete()
    {
        if (!GoogleAuthentication.IsConfigured(config)) return NotFound();
        var external = await HttpContext.AuthenticateAsync(GoogleAuthentication.ExternalScheme);
        try
        {
            if (!external.Succeeded || external.Principal == null || !string.Equals(external.Principal.FindFirstValue("email_verified"), "true", StringComparison.OrdinalIgnoreCase))
                return Unauthorized(new { message = "Google sign-in could not be verified." });
            long? link = null;
            if (!GoogleCloudMode.Enabled(config) && external.Properties?.Items.TryGetValue("link_user", out var linkId) == true)
            {
                if (!long.TryParse(linkId, out var id) || User.Identity?.IsAuthenticated != true || User.FindFirstValue(ClaimTypes.NameIdentifier) != linkId)
                    return Unauthorized();
                link = id;
            }
            var subject = external.Principal.FindFirstValue(ClaimTypes.NameIdentifier) ?? "";
            var user = GoogleCloudMode.Enabled(config)
                ? await identities.SignInCloudAsync(subject, external.Principal.FindFirstValue(ClaimTypes.Email) ?? "", external.Principal.FindFirstValue(ClaimTypes.Name))
                : await identities.ResolveAsync(subject, link, config.GetValue("Security:AllowRegistration", !SecurityRuntime.PublicHosting));
            var principal = new ClaimsPrincipal(new ClaimsIdentity(new[]
            {
                new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()), new Claim(ClaimTypes.Name, GoogleCloudMode.Enabled(config) ? new string((external.Principal.FindFirstValue(ClaimTypes.Name) ?? "Google user").Where(c => !char.IsControl(c)).Take(200).ToArray()) : user.Username), new Claim(ClaimTypes.Role, user.Role.ToString()), new Claim(GoogleCloudMode.MethodClaim, "google")
            }, CookieAuthenticationDefaults.AuthenticationScheme));
            await HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal);
            return Redirect("/");
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException)
        { return Redirect("/login?googleError=account"); }
        finally { await HttpContext.SignOutAsync(GoogleAuthentication.ExternalScheme); }
    }

    [HttpGet("google/profile"), Authorize]
    public IActionResult Profile()
    {
        var id = long.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        using var session = Common.Framework.Data.DbHelper.GetSession();
        var profile = session.Query<BankStatementAnalytics.Models.ExternalLogin>().FirstOrDefault(x => x.UserId == id && x.Provider == "Google");
        return Ok(new { displayName = profile?.DisplayName, email = profile?.Email });
    }
}
