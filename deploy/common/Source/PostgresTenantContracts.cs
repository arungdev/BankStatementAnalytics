using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Npgsql;

namespace Common.Framework.Tenancy.Postgres;

public sealed record TenantKey(string Kind, string Value)
{
    public void Validate()
    {
        if (Kind is not ("user" or "organization") || string.IsNullOrWhiteSpace(Value) || Value.Length > 200 || Value.Any(char.IsControl))
            throw new ArgumentException("Invalid tenant identity.");
    }
}

public sealed record TenantDescriptor(Guid Id, TenantKey Key, string Schema, string Role, string State);

public static class TenantIdentifiers
{
    public static string Quote(string identifier)
    {
        if (!Regex.IsMatch(identifier, "^[a-z][a-z0-9_]{0,62}$", RegexOptions.CultureInvariant))
            throw new ArgumentException("Invalid PostgreSQL identifier.");
        return '"' + identifier + '"';
    }
    public static string Qualified(string schema, string table) => Quote(schema) + "." + Quote(table);
    public static string CacheKey(Guid tenant, string key) => tenant.ToString("N") + ":" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key)));
}

public sealed class PostgresTenantOptions
{
    public required string OperatorConnectionString { get; init; }
    public string MetadataSchema { get; init; } = "cf_tenancy";
    public int MaximumPoolSize { get; init; } = 2;
    public string SubjectClaim { get; init; } = ClaimTypes.NameIdentifier;
    public string OrganizationClaim { get; init; } = "organization_id";
    public int MaximumSnapshotBytes { get; init; } = 64 * 1024 * 1024;
}

public sealed record TenantMigration(int Version, int Order, string Id, string Checksum,
    Func<TenantMigrationContext, CancellationToken, Task> Apply);

public sealed class TenantMigrationContext(NpgsqlConnection connection, NpgsqlTransaction transaction, TenantDescriptor tenant)
{
    public NpgsqlConnection Connection { get; } = connection;
    public NpgsqlTransaction Transaction { get; } = transaction;
    public TenantDescriptor Tenant { get; } = tenant;
    public string Table(string name) => TenantIdentifiers.Qualified(Tenant.Schema, name);
    public async Task ExecuteAsync(string sql, CancellationToken token = default)
    {
        await using var command = new NpgsqlCommand(sql, Connection, Transaction);
        await command.ExecuteNonQueryAsync(token);
    }
}

public interface ITenantSchemaDefinition
{
    IReadOnlyList<TenantMigration> Migrations { get; }
    IReadOnlyList<string> Tables { get; }
}

public interface IPostgresTenantStore
{
    Task<TenantDescriptor> ProvisionAsync(TenantKey key, string initialMember, CancellationToken token = default);
    Task<TenantDescriptor> ResolveAsync(ClaimsPrincipal principal, CancellationToken token = default);
    Task<TenantConnectionLease> OpenDataConnectionAsync(ClaimsPrincipal principal, CancellationToken token = default);
    Task MigrateAllAsync(CancellationToken token = default);
}

/// <summary>Explicitly release session advisory locks before returning a connection to its role-specific pool.</summary>
public sealed class TenantConnectionLease(NpgsqlConnection connection) : IDisposable, IAsyncDisposable
{
    public NpgsqlConnection Connection { get; } = connection;
    private int _disposed;
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed,1) != 0) return;
        try { if (Connection.State == System.Data.ConnectionState.Open) { using var command=new NpgsqlCommand("select pg_advisory_unlock_all()",Connection); command.ExecuteNonQuery(); } }
        finally { Connection.Dispose(); }
    }
    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed,1) != 0) return;
        try {
            if (Connection.State == System.Data.ConnectionState.Open) {
                await using var command = new NpgsqlCommand("select pg_advisory_unlock_all()",Connection);
                await command.ExecuteNonQueryAsync();
            }
        } finally { await Connection.DisposeAsync(); }
    }
}

/// <summary>A scope is revocable: child tasks cannot retain a disposed request's authority.</summary>
public sealed class TenantExecutionContext
{
    private sealed class Frame(ClaimsPrincipal principal, Guid tenant, Frame? previous)
    {
        public readonly ClaimsPrincipal Principal = principal;
        public readonly Guid Tenant = tenant;
        public readonly Frame? Previous = previous;
        public volatile bool Active = true;
    }
    private readonly AsyncLocal<Frame?> _current = new();
    public bool HasScope => _current.Value is {Active:true};
    public Guid TenantId => Current.Tenant;
    public ClaimsPrincipal Principal => Current.Principal.Clone();
    public string CacheKey(string key) => TenantIdentifiers.CacheKey(TenantId,key);
    private Frame Current => _current.Value is { Active: true } current ? current : throw new UnauthorizedAccessException("No active tenant scope.");
    public IDisposable Enter(ClaimsPrincipal principal, TenantDescriptor verifiedTenant)
    {
        if (principal.Identity?.IsAuthenticated != true || verifiedTenant.State != "active") throw new UnauthorizedAccessException("Tenant access is unavailable.");
        var frame = new Frame(principal.Clone(), verifiedTenant.Id, _current.Value);
        _current.Value = frame;
        return new Scope(this, frame);
    }
    private sealed class Scope(TenantExecutionContext context, Frame frame) : IDisposable
    {
        public void Dispose()
        {
            if (!frame.Active) return;
            if (context._current.Value != frame) throw new InvalidOperationException("Tenant scopes must be disposed in reverse order.");
            frame.Active = false;
            context._current.Value = frame.Previous;
        }
    }
}
