using System.Security.Cryptography;
using Common.Framework.Auth;
using Common.Framework.Data;
using BankStatementAnalytics.Models;
using Microsoft.AspNetCore.Identity;
using NHibernate.Linq;
namespace BankStatementAnalytics.Services;

public sealed class GoogleIdentityService
{
    private static readonly SemaphoreSlim Creation = new(1, 1);
    public async Task<AppUser> SignInCloudAsync(string subject, string verifiedEmail, string? displayName)
    {
        if (string.IsNullOrWhiteSpace(subject) || subject.Length > 200 || subject.Any(char.IsControl)
            || string.IsNullOrWhiteSpace(verifiedEmail) || verifiedEmail.Length > 320 || verifiedEmail.Any(char.IsControl)) throw new ArgumentException("Invalid Google identity configuration.");
        displayName = new string((displayName ?? "Google user").Where(c => !char.IsControl(c)).Take(200).ToArray());
        var key = GPayEvidenceService.Hash("Google|" + subject);
        await Creation.WaitAsync();
        try
        {
            using var session = DbHelper.GetSession();
            var identity = await session.GetAsync<ExternalLogin>(key);
            AppUser user;
            var created = identity == null;
            using (var transaction = session.BeginTransaction())
            {
                if (identity == null)
                {
                    // A separate workspace, never an email-based merge with a legacy user.
                    user = new AppUser { Username = "google_" + Guid.NewGuid().ToString("N"), Role = AppRole.User, IsActive = true, CreatedAt = DateTime.UtcNow };
                    user.PasswordHash = new PasswordHasher<AppUser>().HashPassword(user, Convert.ToBase64String(RandomNumberGenerator.GetBytes(48)));
                    await session.SaveAsync(user);
                    identity = new ExternalLogin { Id = key, UserId = user.Id, Provider = "Google", Subject = subject };
                    await session.SaveAsync(identity);
                }
                else
                {
                    user = await session.GetAsync<AppUser>(identity.UserId) ?? throw new InvalidOperationException("Account unavailable.");
                    if (!user.IsActive) throw new InvalidOperationException("Account unavailable.");
                    user.Role = AppRole.User; // Cloud Google identities never carry an application administrator role.
                }
                identity.Email = verifiedEmail;
                identity.DisplayName = displayName;
                user.LastLoginAt = DateTime.UtcNow;
                await transaction.CommitAsync();
            }
            if (created) UserProvisioningService.SeedDefaultsForUser(user.Id);
            return user;
        }
        finally { Creation.Release(); }
    }
    public async Task<AppUser> ResolveAsync(string subject, long? linkTo, bool allowRegistration)
    {
        if (string.IsNullOrWhiteSpace(subject) || subject.Length > 200 || subject.Any(char.IsControl)) throw new ArgumentException("Invalid provider subject.");
        var key = GPayEvidenceService.Hash("Google|" + subject);
        await Creation.WaitAsync();
        try
        {
            using var session = DbHelper.GetSession();
            var identity = await session.GetAsync<ExternalLogin>(key);
            if (identity != null)
            {
                if (linkTo.HasValue && identity.UserId != linkTo.Value) throw new InvalidOperationException("This Google identity is already linked.");
                var existing = AuthService.GetUser(identity.UserId);
                if (existing == null || !existing.IsActive) throw new InvalidOperationException("Account is unavailable.");
                return existing;
            }
            AppUser user;
            if (linkTo.HasValue)
                user = AuthService.GetUser(linkTo.Value) ?? throw new InvalidOperationException("Account is unavailable.");
            else
            {
                if (!allowRegistration || AuthService.NeedsSetup()) throw new InvalidOperationException("Ask an administrator to create your account, then link Google in Profile settings.");
                // Do not search/link by email or username. An external signup gets a
                // new regular user with an unguessable local password, never Admin.
                user = AuthService.CreateUser("google_" + Guid.NewGuid().ToString("N"), Convert.ToBase64String(RandomNumberGenerator.GetBytes(48)), AppRole.User);
                UserProvisioningService.SeedDefaultsForUser(user.Id);
            }
            if (!user.IsActive) throw new InvalidOperationException("Account is unavailable.");
            using var transaction = session.BeginTransaction();
            await session.SaveAsync(new ExternalLogin { Id = key, UserId = user.Id, Provider = "Google", Subject = subject });
            await transaction.CommitAsync();
            return user;
        }
        finally { Creation.Release(); }
    }
}
