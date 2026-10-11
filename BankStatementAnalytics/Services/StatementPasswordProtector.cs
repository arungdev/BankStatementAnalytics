using Microsoft.AspNetCore.DataProtection;

namespace BankStatementAnalytics.Services;

/// <summary>Separate, backed-up key ring for statement passwords (never auth cookies).</summary>
public sealed class StatementPasswordProtector
{
    private const string Prefix = "protected:v1:";
    private readonly IDataProtector _protector;

    public StatementPasswordProtector() : this(new DirectoryInfo(Path.Combine(UploadStorage.Root, ".statement-keys"))) { }

    public StatementPasswordProtector(DirectoryInfo keys)
    {
        // BackupService includes the Uploads tree; restoring the database therefore
        // also restores the keys needed to read its statement passwords.
        _protector = DataProtectionProvider.Create(keys,
            options => options.SetApplicationName("BankStatementAnalytics.StatementPasswords"))
            .CreateProtector("statement-password.v1");
    }

    public string? Protect(string? value) => string.IsNullOrEmpty(value)
        ? null : Prefix + _protector.Protect(value);

    public string? Unprotect(string? value) => string.IsNullOrEmpty(value)
        ? null : value.StartsWith(Prefix, StringComparison.Ordinal)
            ? _protector.Unprotect(value[Prefix.Length..]) : value;

    public bool IsProtected(string value) => value.StartsWith(Prefix, StringComparison.Ordinal);
}
