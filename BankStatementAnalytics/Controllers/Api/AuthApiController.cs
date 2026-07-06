using BankStatementAnalytics.Services;
using Common.Framework.Auth;

namespace BankStatementAnalytics.Controllers.Api
{
    /// <summary>
    /// All auth endpoints (status/setup/login/logout/change-password/user management) are
    /// inherited from AuthApiControllerBase - this class only wires the app-specific
    /// provisioning hooks: a brand-new install seeds default categories/tags for the new
    /// user, while an upgrade from a pre-multi-user install adopts existing owner-less data
    /// for the very first Admin instead of double-seeding.
    /// </summary>
    public class AuthApiController : AuthApiControllerBase
    {
        protected override Task OnFirstAdminCreatedAsync(AppUser admin)
        {
            var adopted = UserProvisioningService.BackfillOwnerlessDataTo(admin.Id);
            if (!adopted)
                UserProvisioningService.SeedDefaultsForUser(admin.Id);

            return Task.CompletedTask;
        }

        protected override Task OnUserCreatedAsync(AppUser user)
        {
            UserProvisioningService.SeedDefaultsForUser(user.Id);
            return Task.CompletedTask;
        }
    }
}
