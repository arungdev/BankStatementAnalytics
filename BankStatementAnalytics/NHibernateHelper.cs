using NHibernate;
using NHibernate.Cfg;
using NHibernate.Mapping.ByCode;
using NHibernate.Tool.hbm2ddl;
using BankStatementAnalytics.Mapping;
using BankStatementAnalytics.Mappping;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics
{
    public static class NHibernateHelper
    {
        private static ISessionFactory? _sessionFactory;

        public static ISessionFactory SessionFactory
        {
            get
            {
                if (_sessionFactory == null)
                {
                    var mapper = new ModelMapper();

                    mapper.AddMapping<AccountMap>();
                    mapper.AddMapping<BankStatementMap>();
                    mapper.AddMapping<CounterPartyUpiMap>();
                    mapper.AddMapping<CounterPartyMap>();
                    mapper.AddMapping<IobTransactionMap>();
                    mapper.AddMapping<HdfcTransactionMap>();

                    var mapping =
                        mapper.CompileMappingForAllExplicitlyAddedEntities();

                    var cfg = new Configuration();

                    cfg.DataBaseIntegration(db =>
                    {
                        var dbPath = Path.Combine(
                            AppContext.BaseDirectory,
                            "Data",
                            "DataBase.db");

                        Directory.CreateDirectory(
                            Path.GetDirectoryName(dbPath)!);

                        db.ConnectionString =
                            $"Data Source={dbPath};Version=3;";

                        db.Driver<NHibernate.Driver.SQLite20Driver>();
                        db.Dialect<NHibernate.Dialect.SQLiteDialect>();


                    });

                    cfg.AddMapping(mapping);

                    new SchemaUpdate(cfg)
                        .Execute(false, true);

                    _sessionFactory =
                        cfg.BuildSessionFactory();
                }

                return _sessionFactory;
            }
        }
    }
}