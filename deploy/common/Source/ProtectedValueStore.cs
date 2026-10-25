using System;
using System.IO;
using Microsoft.AspNetCore.DataProtection;

namespace Common.Framework.Deployment;

// Caller controls the persisted key directory and isolation purposes. Back up keys with data.
public sealed class ProtectedValueStore
{
    private readonly string _prefix;
    private readonly IDataProtector _protector;

    public ProtectedValueStore(DirectoryInfo keys, string applicationName, string purpose, string prefix = "protected:v1:")
    {
        _prefix = prefix;
        _protector = DataProtectionProvider.Create(keys, options => options.SetApplicationName(applicationName))
            .CreateProtector(purpose);
    }

    public string? Protect(string? value) => string.IsNullOrEmpty(value) ? null : _prefix + _protector.Protect(value);
    public string? Unprotect(string? value) => string.IsNullOrEmpty(value) ? null
        : IsProtected(value) ? _protector.Unprotect(value[_prefix.Length..]) : value;
    public bool IsProtected(string value) => value.StartsWith(_prefix, StringComparison.Ordinal);
}
