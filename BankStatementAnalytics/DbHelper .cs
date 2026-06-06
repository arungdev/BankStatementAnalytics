using NHibernate;
using System.Linq.Expressions;
namespace BankStatementAnalytics.Data
{
    public static class DbHelper
    {
        public static readonly ISessionFactory _factory =
            NHibernateHelper.SessionFactory;

        public static NHibernate.ISession GetSession()
        {
            return _factory.OpenSession();
        }
        public static async Task SaveAsync<T>(T entity)
        {
            using var session = _factory.OpenSession();
            using var tx = session.BeginTransaction();

            await session.SaveAsync(entity);

            await tx.CommitAsync();
        }

        public static async Task UpdateAsync<T>(T entity)
        {
            using var session = _factory.OpenSession();
            using var tx = session.BeginTransaction();

            await session.UpdateAsync(entity);

            await tx.CommitAsync();
        }

        public static async Task DeleteAsync<T>(T entity)
        {
            using var session = _factory.OpenSession();
            using var tx = session.BeginTransaction();

            await session.DeleteAsync(entity);

            await tx.CommitAsync();
        }

        public static T? GetById<T>(object id)
        {
            using var session = _factory.OpenSession();

            return session.Get<T>(id);
        }

        public static List<T> GetAll<T>()
        {
            using var session = _factory.OpenSession();

            return session.Query<T>().ToList();
        }

        public static List<T> Find<T>(
            Expression<Func<T, bool>> predicate)
        {
            using var session = _factory.OpenSession();

            return session.Query<T>()
                          .Where(predicate)
                          .ToList();
        }

        public static async Task SaveOrUpdateManyAsync<T>(IEnumerable<T> entities)
        {
            using var session = _factory.OpenSession();
            using var tx = session.BeginTransaction();

            foreach (T temp in entities)
            {
                await session.SaveOrUpdateAsync(temp);
            }

            await tx.CommitAsync();
        }
        public static T? FirstOrDefault<T>(
            Expression<Func<T, bool>> predicate)
        {
            using var session = _factory.OpenSession();

            return session.Query<T>()
                          .FirstOrDefault(predicate);
        }
        public static List<T> QueryList<T>()
        {
            using var session = _factory.OpenSession();
            return session.Query<T>().ToList();
        }
    }
}