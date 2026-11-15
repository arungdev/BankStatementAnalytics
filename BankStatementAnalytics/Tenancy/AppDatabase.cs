using System.Linq.Expressions;
using NHibernate.Linq;
using ISession = NHibernate.ISession;

namespace BankStatementAnalytics.Tenancy;

/// <summary>Financial data only. Authentication always uses the shared framework DbHelper.</summary>
public static class AppDatabase
{
    public static ISession GetSession() => AppTenantRuntime.Enabled ? AppTenantRuntime.Sessions.OpenSession() : Common.Framework.Data.DbHelper.GetSession();
    public static T? GetById<T>(object id) where T:class { using var session=GetSession(); return session.Get<T>(id); }
    public static async Task<T?> GetByIdAsync<T>(object id) where T:class { using var session=GetSession(); return await session.GetAsync<T>(id); }
    public static IList<T> GetAll<T>() where T:class { using var session=GetSession(); return session.Query<T>().ToList(); }
    public static async Task<IList<T>> QueryAsync<T>(Expression<Func<T,bool>> predicate) where T:class { using var session=GetSession(); return await session.Query<T>().Where(predicate).ToListAsync(); }
    public static async Task<IList<TResult>> QueryAsync<T,TResult>(Expression<Func<T,bool>> predicate,Expression<Func<T,TResult>> selector) where T:class { using var session=GetSession(); return await session.Query<T>().Where(predicate).Select(selector).ToListAsync(); }
    public static Task SaveAsync<T>(T entity) where T:class => WriteAsync(entity,0);
    public static Task UpdateAsync<T>(T entity) where T:class => WriteAsync(entity,1);
    public static Task DeleteAsync<T>(T entity) where T:class => WriteAsync(entity,2);
    private static async Task WriteAsync<T>(T entity,int operation) where T:class {
        using var session=GetSession(); using var tx=session.BeginTransaction();
        if(operation==0) await session.SaveAsync(entity); else if(operation==1) await session.UpdateAsync(entity); else await session.DeleteAsync(entity);
        await tx.CommitAsync();
    }
}
