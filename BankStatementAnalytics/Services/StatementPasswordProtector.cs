using Common.Framework.Deployment;

namespace BankStatementAnalytics.Services;

// Product-specific key location and purposes are retained for existing backups.
public sealed class StatementPasswordProtector
{
    private readonly ProtectedValueStore _store;
    public StatementPasswordProtector() : this(new DirectoryInfo(Path.Combine(UploadStorage.Root, ".statement-keys"))) { }
    public StatementPasswordProtector(DirectoryInfo keys) =>
        _store = new ProtectedValueStore(keys, "BankStatementAnalytics.StatementPasswords", "statement-password.v1");
    public string? Protect(string? value) => _store.Protect(value);
    public string? Unprotect(string? value) => _store.Unprotect(value);
    public bool IsProtected(string value) => _store.IsProtected(value);
}
