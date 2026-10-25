namespace BankStatementAnalytics.Models;

// Provider subject, never an email address, defines the external identity.
public class ExternalLogin
{
    public virtual string Id { get; set; } = "";
    public virtual long UserId { get; set; }
    public virtual string Provider { get; set; } = "";
    public virtual string Subject { get; set; } = "";
    public virtual string? Email { get; set; }
    public virtual string? DisplayName { get; set; }
}
