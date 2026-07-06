using System.IO;
using System;
using NHibernate;
using Microsoft.Extensions.Configuration;
using BankStatementAnalytics.Mapping;
using BankStatementAnalytics.Mappping;
using Common.Framework.Auth;
using Common.Framework.Data;
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
                    var appDir = Common.Framework.AppPaths.ResolveAppDirectory();
                    var dataDir = Path.Combine(appDir, "Data");
                    var dbPath = Path.Combine(dataDir, "DataBase.db");

                    // Layer config the same way the ASP.NET host does: base file, then the
                    // environment-specific override, then environment variables. This lets a
                    // Development override change the DB provider, and lets secrets like the
                    // Postgres password come from an env var (Database__PostgresConnectionString)
                    // instead of being committed in appsettings.json.
                    var env = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Production";
                    var config = new ConfigurationBuilder()
                        .SetBasePath(appDir)
                        .AddJsonFile("appsettings.json", optional: true)
                        .AddJsonFile($"appsettings.{env}.json", optional: true)
                        .AddEnvironmentVariables()
                        .Build();

                    var isPostgres = string.Equals(config["Database:Provider"], "Postgres", StringComparison.OrdinalIgnoreCase);
                    var isEmbedded = isPostgres && string.Equals(config["Database:Embedded"], "true", StringComparison.OrdinalIgnoreCase);

                    if (isEmbedded)
                    {
                        EmbeddedPostgresManager.EnsureStarted(appDir, databaseName: "bankstatements");
                    }

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
                    }, null,
                    isPostgres
                        ? db =>
                        {
                            db.ConnectionString = isEmbedded ? EmbeddedPostgresManager.ConnectionString : config["Database:PostgresConnectionString"];
                            db.Driver<NHibernate.Driver.NpgsqlDriver>();
                            db.Dialect<NHibernate.Dialect.PostgreSQL83Dialect>();
                        }
                        : null);

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
