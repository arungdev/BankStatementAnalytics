using System.Reflection;
using System.Runtime.ExceptionServices;
using NHibernate;
using NHibernate.Cfg;
using Npgsql;
using ISession = NHibernate.ISession;

namespace Common.Framework.Tenancy.Postgres;

/// <summary>Immutable, unqualified mappings; each session owns a separately authorized connection.</summary>
public sealed class PostgresTenantSessions : IDisposable
{
    private readonly ISessionFactory _factory;
    private readonly IPostgresTenantStore _store;
    private readonly TenantExecutionContext _context;
    public PostgresTenantSessions(Configuration configuration, IPostgresTenantStore store, TenantExecutionContext context)
    {
        _store=store; _context=context;
        configuration.SetProperty(NHibernate.Cfg.Environment.UseSecondLevelCache,"false");
        configuration.SetProperty(NHibernate.Cfg.Environment.UseQueryCache,"false");
        configuration.SetProperty("hbm2ddl.keywords","none");
        // No schema update/export or mutable per-request default_schema configuration.
        _factory=configuration.BuildSessionFactory();
    }
    public ISession OpenSession()
    {
        var tenant = _context.TenantId;
        if (_store.ResolveAsync(_context.Principal).GetAwaiter().GetResult().Id != tenant) throw new UnauthorizedAccessException("Tenant scope does not match authenticated membership.");
        var connection = _store.OpenDataConnectionAsync(_context.Principal).GetAwaiter().GetResult();
        try {
            Func<bool> authorized=() => _context.TenantId == tenant;
            var inner = _factory.WithOptions().Connection(connection.Connection).Interceptor(new TenantStatementGuard(authorized)).OpenSession();
            var proxy = DispatchProxy.Create<ISession, TenantSessionProxy>();
            ((TenantSessionProxy)(object)proxy).Initialize(inner,connection,() => _context.TenantId == tenant);
            return proxy;
        } catch { connection.Dispose(); throw; }
    }
    public void Dispose() => _factory.Dispose();
}

internal sealed class TenantStatementGuard(Func<bool> authorized) : EmptyInterceptor
{
    public override NHibernate.SqlCommand.SqlString OnPrepareStatement(NHibernate.SqlCommand.SqlString sql)
    {
        if(!authorized()) throw new UnauthorizedAccessException("Database query escaped its tenant scope.");
        return sql;
    }
}

public class TenantSessionProxy : DispatchProxy
{
    private ISession _inner = null!;
    private TenantConnectionLease _connection = null!;
    private int _disposed;
    private Func<bool> _authorized = null!;
    internal void Initialize(ISession inner, TenantConnectionLease connection, Func<bool> authorized) { _inner=inner; _connection=connection; _authorized=authorized; }
    protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
    {
        if (targetMethod == null) throw new InvalidOperationException();
        if (targetMethod.Name is "Dispose" or "Close") {
            if (Interlocked.Exchange(ref _disposed,1) != 0) return null;
            try { _inner.Dispose(); }
            finally {
                _connection.Dispose();
            }
            return null;
        }
        if (Volatile.Read(ref _disposed) != 0) throw new ObjectDisposedException("Tenant session");
        if (!_authorized()) throw new UnauthorizedAccessException("Session belongs to another tenant scope.");
        try { return targetMethod.Invoke(_inner,args); }
        catch (TargetInvocationException error) when (error.InnerException != null) { ExceptionDispatchInfo.Capture(error.InnerException).Throw(); throw; }
    }
}
