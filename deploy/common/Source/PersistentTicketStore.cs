using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;

namespace Common.Framework.Deployment;

// Standard cookie-ticket storage with durable logout revocation. One active app
// process per store is required (the consumer already has that deployment contract).
public sealed class PersistentTicketStore : ITicketStore
{
    private readonly string _root;
    private readonly IDataProtector _protector;
    private readonly SemaphoreSlim _gate = new(1, 1);
    public PersistentTicketStore(string root, IDataProtectionProvider protection)
    {
        _root = Path.GetFullPath(root);
        Directory.CreateDirectory(_root);
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(_root, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        _protector = protection.CreateProtector("persistent-auth-ticket.v1");
    }
    private string PathFor(string key)
    {
        if (key.Length != 64 || key.Any(c => !Uri.IsHexDigit(c))) throw new ArgumentException("Invalid session identifier.");
        return Path.Combine(_root, key + ".ticket");
    }
    public async Task<string> StoreAsync(AuthenticationTicket ticket)
    {
        var key = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        await _gate.WaitAsync();
        try
        {
            foreach (var file in Directory.EnumerateFiles(_root, "*.ticket").Take(10000))
                if (File.GetLastWriteTimeUtc(file) < DateTime.UtcNow.AddHours(-8)) File.Delete(file);
            if (Directory.EnumerateFiles(_root, "*.ticket").Take(10001).Count() >= 10000) throw new InvalidOperationException("Session capacity reached.");
            await WriteAsync(PathFor(key), ticket);
        }
        finally { _gate.Release(); }
        return key;
    }
    private async Task WriteAsync(string path, AuthenticationTicket ticket)
    {
        var temporary = path + ".tmp";
        try
        {
            await File.WriteAllBytesAsync(temporary, _protector.Protect(TicketSerializer.Default.Serialize(ticket)));
            if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(temporary, UnixFileMode.UserRead | UnixFileMode.UserWrite);
            File.Move(temporary, path, true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    public async Task RenewAsync(string key, AuthenticationTicket ticket)
    {
        await _gate.WaitAsync();
        try
        {
            var path = PathFor(key);
            // A concurrent logout deletes the ticket. Renewal must not resurrect it.
            if (File.Exists(path)) await WriteAsync(path, ticket);
        }
        finally { _gate.Release(); }
    }
    public async Task<AuthenticationTicket?> RetrieveAsync(string key)
    {
        await _gate.WaitAsync();
        try
        {
            var path = PathFor(key);
            if (!File.Exists(path)) return null;
            if (new FileInfo(path).Length > 65536) { File.Delete(path); return null; }
            var ticket = TicketSerializer.Default.Deserialize(_protector.Unprotect(await File.ReadAllBytesAsync(path)));
            if (ticket?.Properties.ExpiresUtc <= DateTimeOffset.UtcNow) { File.Delete(path); return null; }
            return ticket;
        }
        catch (Exception ex) when (ex is CryptographicException or IOException or ArgumentException) { return null; }
        finally { _gate.Release(); }
    }
    public async Task RemoveAsync(string key)
    {
        await _gate.WaitAsync();
        try { File.Delete(PathFor(key)); }
        finally { _gate.Release(); }
    }
    public async Task ClearAsync()
    {
        await _gate.WaitAsync();
        try { foreach (var path in Directory.EnumerateFiles(_root, "*.ticket")) File.Delete(path); }
        finally { _gate.Release(); }
    }
}
