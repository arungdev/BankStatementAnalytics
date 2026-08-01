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
    /// <summary>
    /// Resolved database location, as seen from outside NHibernate. <paramref name="AppDir"/> is the
    /// install directory holding the bundled Postgres binaries (appDir\pgsql\bin);
    /// <paramref name="ConnectionString"/> is null when the app is running on the SQLite fallback.
    /// </summary>
    public sealed record DatabaseInfo(bool IsPostgres, bool IsEmbedded, string AppDir, string? ConnectionString);

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
                    // Writable state (DB + embedded Postgres data) may need to live outside a
                    // read-only Program Files install dir - resolve it separately from appDir,
                    // which still points at the read-only bundled pgsql binaries and appsettings.
                    var dataDir = Path.Combine(Common.Framework.AppPaths.ResolveWritableAppDataDirectory(), "Data");
                    var dbPath = Path.Combine(dataDir, "DataBase.db");

                    var config = BuildConfig(appDir);

                    var isPostgres = string.Equals(config["Database:Provider"], "Postgres", StringComparison.OrdinalIgnoreCase);
                    var isEmbedded = isPostgres && string.Equals(config["Database:Embedded"], "true", StringComparison.OrdinalIgnoreCase);

                    Log.Info($"NHibernate init: appDir='{appDir}', dataDir='{dataDir}', dbPath='{dbPath}', provider={(isPostgres ? "Postgres" : "SQLite")}, embedded={isEmbedded}.");

                    if (isEmbedded)
                    {
                        EmbeddedPostgresManager.EnsureStarted(appDir, dataDir, databaseName: "bankstatements");
                    }

                    NHibernateManager.Initialize(dbPath, mapper =>
                    {
                        mapper.AddMapping<AppUserMap>();
                        mapper.AddMapping<AccountMap>();
                        mapper.AddMapping<MerchantUpiMap>();
                        mapper.AddMapping<MerchantMap>();
                        mapper.AddMapping<BankTransactionMap>();
                        mapper.AddMapping<UploadMap>();
                        mapper.AddMapping<ImportHistoryMap>();
                        mapper.AddMapping<CardStatementSummaryMap>();
                        mapper.AddMapping<UploadTransactionMap>();
                        mapper.AddMapping<CategoryMap>();
                        mapper.AddMapping<SubCategoryMap>();
                        mapper.AddMapping<TagMap>();
                        mapper.AddMapping<RecurringBillMap>();
                        mapper.AddMapping<BudgetMap>();
                        mapper.AddMapping<DepositMap>();
                    }, null,
                    isPostgres
                        ? db =>
                        {
                            db.ConnectionString = isEmbedded ? EmbeddedPostgresManager.ConnectionString : config["Database:PostgresConnectionString"];
                            db.Driver<NHibernate.Driver.NpgsqlDriver>();
                            db.Dialect<NHibernate.Dialect.PostgreSQL83Dialect>();
                        }
                        : null);

                    CreateExpressionIndexes();

                    return NHibernateManager.SessionFactory;
                }
                catch (Exception ex)
                {
                    Log.Exception(ex);
                    throw;
                }
            }
        }

        /// <summary>
        /// Layers config the same way the ASP.NET host does: base file, then the
        /// environment-specific override, then environment variables. This lets a
        /// Development override change the DB provider, and lets secrets like the
        /// Postgres password come from an env var (Database__PostgresConnectionString)
        /// instead of being committed in appsettings.json.
        /// </summary>
        private static IConfigurationRoot BuildConfig(string appDir)
        {
            var env = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Production";
            return new ConfigurationBuilder()
                .SetBasePath(appDir)
                .AddJsonFile("appsettings.json", optional: true)
                .AddJsonFile($"appsettings.{env}.json", optional: true)
                .AddEnvironmentVariables()
                .Build();
        }

        /// <summary>
        /// Where the database physically lives, for the tools that have to reach it outside
        /// NHibernate — <see cref="Services.BackupService"/> shells out to pg_dump/pg_restore and
        /// needs the host/port/credentials plus the folder holding the bundled Postgres binaries.
        /// Re-reads the same layered config rather than caching what
        /// <see cref="SessionFactory"/> resolved, so it doesn't depend on init order.
        /// </summary>
        public static DatabaseInfo Describe()
        {
            var appDir = Common.Framework.AppPaths.ResolveAppDirectory();
            var config = BuildConfig(appDir);

            var isPostgres = string.Equals(config["Database:Provider"], "Postgres", StringComparison.OrdinalIgnoreCase);
            var isEmbedded = isPostgres && string.Equals(config["Database:Embedded"], "true", StringComparison.OrdinalIgnoreCase);

            // The embedded instance's port and password are generated on first run and known only
            // to the manager, so its live connection string is the only source for them.
            var connectionString = isPostgres
                ? (isEmbedded ? EmbeddedPostgresManager.ConnectionString : config["Database:PostgresConnectionString"])
                : null;

            return new DatabaseInfo(isPostgres, isEmbedded, appDir, connectionString);
        }

        /// <summary>
        /// Indexes that mapping-by-code can't express, created after SchemaUpdate has built
        /// the tables. All are IF NOT EXISTS, so this is a cheap no-op on every start after
        /// the first, and failures are logged rather than thrown: a missing index makes
        /// queries slower, not wrong.
        /// </summary>
        private static void CreateExpressionIndexes()
        {
            // Analytics (trends, insights, budgets, reports, the transactions month filter)
            // all attribute a row to a month by COALESCE(EffectiveDate, TransactionDate) so
            // that merchants flagged ShiftToNextMonth land in the following month. That
            // expression can't use IX_BankTransactions_Account_Date — the planner only
            // matches an index on the bare TransactionDate column — so every one of those
            // date-range filters degrades into a full scan of the user's rows. An index on
            // the expression itself makes them index-scannable again.
            //
            // Written unquoted so it works on both providers: PostgreSQL folds the
            // identifiers to the lowercase names NHibernate created, and SQLite treats
            // identifiers case-insensitively. COALESCE is deterministic, so both accept it
            // in an index expression.
            var statements = new[]
            {
                @"create index if not exists ix_banktransactions_account_effectivedate
                    on bank_transactions (accountid, coalesce(effectivedate, transactiondate))",

                // Uploads and auto-import history are both listed per account.
                @"create index if not exists ix_uploads_accountid on uploads (accountid)",
            };

            foreach (var sql in statements)
            {
                try
                {
                    using var session = NHibernateManager.SessionFactory.OpenStatelessSession();
                    session.CreateSQLQuery(sql).ExecuteUpdate();
                }
                catch (Exception ex)
                {
                    Log.Info($"Could not create performance index (continuing without it): {ex.Message}");
                }
            }
        }
    }
}
