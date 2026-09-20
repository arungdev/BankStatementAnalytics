using Common.Framework.Migrations;

namespace BankStatementAnalytics.Migrations
{
    /// <summary>
    /// Central registry of all BankStatementAnalytics database migrations.
    ///
    /// <para><b>How to add a new migration</b><br/>
    /// 1. Increment the version number and call <c>mb.ForVersion(n)</c>.<br/>
    /// 2. Chain one or more <c>.AddStep("description", ctx => { … })</c> calls.<br/>
    /// 3. Never edit or delete a version that has already shipped — only add new ones.<br/>
    /// 4. Guard DDL steps with <see cref="IMigrationContext.ColumnExists"/> or
    ///    <see cref="IMigrationContext.TableExists"/> so they are safe to replay on
    ///    databases where NHibernate SchemaUpdate has already applied the change.<br/>
    /// 5. Use <see cref="IMigrationContext.Provider"/> when column types differ
    ///    between SQLite and PostgreSQL (e.g. <c>UUID</c> vs <c>TEXT</c>).
    /// </para>
    ///
    /// <para><b>Execution contract</b><br/>
    /// The <see cref="Common.Framework.Migrations.MigrationRunner"/> in
    /// <see cref="Common.Framework.Data.NHibernateManager.Initialize"/> reads the
    /// current version from <c>__db_version</c> and runs only versions whose number
    /// exceeds that value, in ascending order. Each version's steps run inside a
    /// single transaction; on failure the version rolls back and the app refuses
    /// to start.
    /// </para>
    /// </summary>
    public static class AppMigrations
    {
        /// <summary>
        /// Registers every migration. Called from <see cref="NHibernateHelper"/> during startup.
        /// </summary>
        public static void Register(MigrationBuilder mb)
        {
            // ── Version 1 ────────────────────────────────────────────────────────────
            // Baseline guard migrations for columns that were added to the entity model
            // over time and are already present in deployed databases via SchemaUpdate.
            // Every step is wrapped in a ColumnExists guard so it is a no-op when the
            // column already exists, and repairs a schema that somehow missed SchemaUpdate.
            mb.ForVersion(1)
              .AddStep("Guard: transfergroupid on bank_transactions", ctx =>
              {
                  if (ctx.ColumnExists("bank_transactions", "transfergroupid")) return;
                  // UUID is a proper Postgres type; SQLite stores it as TEXT.
                  var colType = ctx.Provider == DatabaseProvider.PostgreSQL ? "UUID" : "TEXT";
                  ctx.Execute(
                      $"ALTER TABLE bank_transactions ADD COLUMN transfergroupid {colType} NULL");
              })
              .AddStep("Guard: note on bank_transactions", ctx =>
              {
                  if (ctx.ColumnExists("bank_transactions", "note")) return;
                  ctx.Execute(
                      "ALTER TABLE bank_transactions ADD COLUMN note TEXT NULL");
              })
              .AddStep("Guard: categoryoverride on bank_transactions", ctx =>
              {
                  if (ctx.ColumnExists("bank_transactions", "categoryoverride")) return;
                  ctx.Execute(
                      "ALTER TABLE bank_transactions ADD COLUMN categoryoverride TEXT NULL");
              })
              .AddStep("Guard: subcategoryoverride on bank_transactions", ctx =>
              {
                  if (ctx.ColumnExists("bank_transactions", "subcategoryoverride")) return;
                  ctx.Execute(
                      "ALTER TABLE bank_transactions ADD COLUMN subcategoryoverride TEXT NULL");
              })
              .AddStep("Guard: tags on bank_transactions", ctx =>
              {
                  if (ctx.ColumnExists("bank_transactions", "tags")) return;
                  ctx.Execute(
                      "ALTER TABLE bank_transactions ADD COLUMN tags TEXT NULL");
              })
              .AddStep("Guard: upivpa on bank_transactions", ctx =>
              {
                  if (ctx.ColumnExists("bank_transactions", "upivpa")) return;
                  ctx.Execute(
                      "ALTER TABLE bank_transactions ADD COLUMN upivpa TEXT NULL");
              });

            // ── Version 2 ────────────────────────────────────────────────────────────
            // Pure data migration: normalize legacy empty-string UpiVpa values to NULL
            // so application code can rely on NULL meaning "not present".
            mb.ForVersion(2)
              .AddStep("Normalize empty UpiVpa to NULL in bank_transactions", ctx =>
              {
                  ctx.Execute(
                      "UPDATE bank_transactions SET upivpa = NULL WHERE upivpa = ''");
              });

            // ── Version 3 ────────────────────────────────────────────────────────────
            // Multi-currency and Forex tracking columns on bank_transactions
            mb.ForVersion(3)
              .AddStep("Guard: originalcurrency on bank_transactions", ctx =>
              {
                  if (ctx.ColumnExists("bank_transactions", "originalcurrency")) return;
                  ctx.Execute("ALTER TABLE bank_transactions ADD COLUMN originalcurrency VARCHAR(10) NULL");
              })
              .AddStep("Guard: originalamount on bank_transactions", ctx =>
              {
                  if (ctx.ColumnExists("bank_transactions", "originalamount")) return;
                  var colType = ctx.Provider == DatabaseProvider.PostgreSQL ? "NUMERIC(18,4)" : "DECIMAL(18,4)";
                  ctx.Execute($"ALTER TABLE bank_transactions ADD COLUMN originalamount {colType} NULL");
              })
              .AddStep("Guard: forexmarkuppercent on bank_transactions", ctx =>
              {
                  if (ctx.ColumnExists("bank_transactions", "forexmarkuppercent")) return;
                  var colType = ctx.Provider == DatabaseProvider.PostgreSQL ? "NUMERIC(5,2)" : "DECIMAL(5,2)";
                  ctx.Execute($"ALTER TABLE bank_transactions ADD COLUMN forexmarkuppercent {colType} NULL");
              });
        }
    }
}
