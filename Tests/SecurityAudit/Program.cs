using System.Security.Claims;
using System.Text;
using Common.Framework.Deployment;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.DataProtection;
using BankStatementAnalytics.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
var checks = 0;
void Check(bool value, string name) { if (!value) throw new Exception(name); Console.WriteLine("PASS: " + name); checks++; }
var scratch = Path.Combine(Path.GetTempPath(), "bsa-security-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(scratch);
var protection = DataProtectionProvider.Create(new DirectoryInfo(Path.Combine(scratch, "keys")));
var root = Path.Combine(scratch, "sessions");
var store = new PersistentTicketStore(root, protection);
AuthenticationTicket Ticket(string name, int minutes = 30) => new(new ClaimsPrincipal(new ClaimsIdentity(
    new[] { new Claim(ClaimTypes.NameIdentifier, name) }, "test")), new AuthenticationProperties { ExpiresUtc = DateTimeOffset.UtcNow.AddMinutes(minutes) }, "test");
var alice = await store.StoreAsync(Ticket("alice"));
var bob = await store.StoreAsync(Ticket("bob"));
Check(alice != bob && alice.Length == 64, "users receive independent cryptographic session identifiers");
Check((await store.RetrieveAsync(alice))?.Principal.FindFirstValue(ClaimTypes.NameIdentifier) == "alice", "session resolves its own identity");
Check(!File.ReadAllText(Path.Combine(root, alice + ".ticket")).Contains("alice"), "stored sessions are protected");
var restarted = new PersistentTicketStore(root, protection);
Check(await restarted.RetrieveAsync(bob) != null, "active sessions survive application restart");
await store.RemoveAsync(alice);
await store.RenewAsync(alice, Ticket("alice"));
Check(await store.RetrieveAsync(alice) == null && await store.RetrieveAsync(bob) != null, "logout remains revoked after renewal without affecting another user");
var expired = await store.StoreAsync(Ticket("expired", -1));
Check(await store.RetrieveAsync(expired) == null, "expired sessions fail closed");
await File.WriteAllTextAsync(Path.Combine(root, bob + ".ticket"), "tampered");
Check(await store.RetrieveAsync(bob) == null, "tampered sessions fail closed");
Check(await store.RetrieveAsync("../outside") == null, "session keys cannot traverse directories");
await store.StoreAsync(Ticket("clear"));
await store.ClearAsync();
Check(!Directory.EnumerateFiles(root, "*.ticket").Any(), "restore can revoke pre-restore sessions");
Check(Encoding.UTF8.GetString(await BoundedUpload.ReadAsync(new MemoryStream("safe"u8.ToArray()), 4)) == "safe", "bounded upload accepts exact size limit");
try { await BoundedUpload.ReadAsync(new MemoryStream(new byte[5]), 4); throw new Exception("oversize accepted"); }
catch (ArgumentException) { Check(true, "bounded upload rejects excessive streamed bytes"); }
Console.WriteLine($"Passed {checks} shared security checks. Synthetic artifacts: {scratch}");

var oauthBuilder = WebApplication.CreateBuilder();
oauthBuilder.Logging.ClearProviders();
oauthBuilder.Services.AddDataProtection().PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(scratch, "oauth-keys")));
oauthBuilder.WebHost.UseUrls("http://127.0.0.1:0");
oauthBuilder.Configuration.AddInMemoryCollection(new Dictionary<string,string?> {
    ["Authentication:Google:ClientId"] = "synthetic.apps.googleusercontent.com",
    ["Authentication:Google:ClientSecret"] = "synthetic-client-secret"
});
oauthBuilder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie();
oauthBuilder.Services.AddGoogleSignIn(oauthBuilder.Configuration);
var fakeGoogle = new SyntheticGoogleHandler();
oauthBuilder.Services.PostConfigure<GoogleOptions>("Google", options => options.Backchannel = new HttpClient(fakeGoogle));
await using var oauth = oauthBuilder.Build();
// Emulate TLS termination only within this disposable loopback host.
oauth.Use(async (context, next) => { context.Request.Scheme = "https"; await next(); });
oauth.UseAuthentication();
oauth.MapGet("/start", () => Results.Challenge(new AuthenticationProperties { RedirectUri = "/complete" }, ["Google"]));
oauth.MapGet("/complete", async (HttpContext context) => {
    var result = await context.AuthenticateAsync(GoogleAuthentication.ExternalScheme);
    return Results.Json(new { authenticated = result.Succeeded, verified = result.Principal?.FindFirstValue("email_verified") });
});
await oauth.StartAsync();
var oauthAddress = oauth.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
using var oauthHttp = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false }) { BaseAddress = new Uri(oauthAddress) };
async Task<(string State,string Cookies)> StartOAuth()
{
    using var response = await oauthHttp.GetAsync("/start");
    Check(response.StatusCode == System.Net.HttpStatusCode.Redirect, "Google challenge redirects to the provider");
    var state = QueryHelpers.ParseQuery(response.Headers.Location!.Query)["state"].ToString();
    var cookies = string.Join("; ", response.Headers.GetValues("Set-Cookie").Select(value => value.Split(';')[0]));
    Check(response.Headers.GetValues("Set-Cookie").All(value => value.Contains("secure", StringComparison.OrdinalIgnoreCase) && value.Contains("samesite=none", StringComparison.OrdinalIgnoreCase)), "correlation cookies require Secure and SameSite=None");
    return (state,cookies);
}
async Task<HttpResponseMessage> Callback((string State,string Cookies) flow, bool sendCookie = true)
{
    var request = new HttpRequestMessage(HttpMethod.Get, "/signin-google?code=synthetic-code&state=" + Uri.EscapeDataString(flow.State));
    if (sendCookie) request.Headers.TryAddWithoutValidation("Cookie", flow.Cookies);
    return await oauthHttp.SendAsync(request);
}
var missingCookieFlow = await StartOAuth();
using (var response = await Callback(missingCookieFlow, false))
    Check(response.Headers.Location?.OriginalString == "/login?googleError=correlation", "missing browser cookie fails closed with an actionable category");
var validFlow = await StartOAuth();
using (var response = await Callback(validFlow))
{
    Check(response.Headers.Location?.OriginalString == "/complete", "valid state and cookie complete the OAuth callback");
    using var complete = new HttpRequestMessage(HttpMethod.Get, "/complete");
    complete.Headers.TryAddWithoutValidation("Cookie", string.Join("; ", response.Headers.GetValues("Set-Cookie").Select(value => value.Split(';')[0])));
    using var completeResponse = await oauthHttp.SendAsync(complete);
    var json = await completeResponse.Content.ReadAsStringAsync();
    using var payload = System.Text.Json.JsonDocument.Parse(json);
    Check(payload.RootElement.GetProperty("authenticated").GetBoolean() &&
        string.Equals(payload.RootElement.GetProperty("verified").GetString(), "true", StringComparison.OrdinalIgnoreCase), "verified Google identity is carried in the protected external cookie");
}
fakeGoogle.FailCredentials = true;
var badCredentialsFlow = await StartOAuth();
using (var response = await Callback(badCredentialsFlow))
{
    Check(response.Headers.Location?.OriginalString == "/login?googleError=credentials", "provider credential rejection is classified without exposing its response");
    Check(!(response.Headers.ToString() + await response.Content.ReadAsStringAsync()).Contains(SyntheticGoogleHandler.SecretSentinel), "provider response secrets never enter browser errors");
}
await oauth.StopAsync();
Console.WriteLine($"Passed {checks} total security and real-handler OAuth checks.");

sealed class SyntheticGoogleHandler : HttpMessageHandler
{
    public const string SecretSentinel = "synthetic-never-expose-this-token";
    public bool FailCredentials { get; set; }
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var token = request.RequestUri!.AbsolutePath.EndsWith("/token", StringComparison.Ordinal);
        var body = token ? (FailCredentials ? "{\"error\":\"invalid_client\",\"error_description\":\"" + SecretSentinel + "\"}" : "{\"access_token\":\"synthetic-token\",\"token_type\":\"Bearer\",\"expires_in\":3600}")
            : "{\"sub\":\"synthetic-subject\",\"email\":\"synthetic@example.invalid\",\"email_verified\":true,\"name\":\"Synthetic\"}";
        return Task.FromResult(new HttpResponseMessage(token && FailCredentials ? System.Net.HttpStatusCode.BadRequest : System.Net.HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
    }
}
