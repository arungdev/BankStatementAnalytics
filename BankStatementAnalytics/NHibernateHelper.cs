using System.IO;
using System;
using NHibernate;
using BankStatementAnalytics.Mapping;
using BankStatementAnalytics.Mappping;
using Common.Framework.Auth;
using Common.Framework.Data;
using Common.Framework.Data.Sqlite;
using Common.Framework.Logging;

namespace BankStatementAnalytics
{
    public static class NHibernateHelper
    {
        public static ISessionFactory SessionFactory
        {
            get
            {
                try
                {
                    return NHibernateManager.SessionFactory;
                }
                catch (InvalidOperationException)
                {
                    var dataDir = Common.Framework.AppPaths.ResolveAppDirectory();
                    dataDir = Path.Combine(dataDir, "Data");
                    var dbPath = Path.Combine(dataDir, "DataBase.db");

                    NHibernateManager.Initialize(dbPath, mapper =>
                    {
                        mapper.AddMapping<AppUserMap>();
                        mapper.AddMapping<AccountMap>();
                        mapper.AddMapping<MerchantUpiMap>();
                        mapper.AddMapping<MerchantMap>();
                        mapper.AddMapping<BankTransactionMap>();
                        mapper.AddMapping<UploadMap>();
                        mapper.AddMapping<UploadTransactionMap>();
                        mapper.AddMapping<CategoryMap>();
                        mapper.AddMapping<SubCategoryMap>();
                        mapper.AddMapping<TagMap>();
                    }, null, db =>
                    {
                        db.ConnectionString = $"Data Source={dbPath};Password=\"x'{DatabaseEncryptionKey.Hex}'\"";
                        db.Driver<MicrosoftDataSqliteDriver>();
                        db.ConnectionProvider<SqlCipherConnectionProvider>();
                        db.Dialect<MicrosoftDataSqliteDialect>();
                        // Microsoft.Data.Sqlite's GetSchema("DataTypes") isn't implemented, which is
                        // what NHibernate uses to auto-import reserved keywords; skip that step.
                        db.KeywordsAutoImport = NHibernate.Cfg.Hbm2DDLKeyWords.None;
                    });

                    return NHibernateManager.SessionFactory;
                }
                catch (Exception ex)
                {
                    Log.Exception(ex);
                    throw;
                }
            }
        }
    }
}
