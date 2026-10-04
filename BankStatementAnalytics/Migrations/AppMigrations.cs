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

            // ── Version 4 ────────────────────────────────────────────────────────────
            // Multi-party split bill and group payments tables
            mb.ForVersion(4)
              .AddStep("Guard: split_groups table", ctx =>
              {
                  if (ctx.TableExists("split_groups") || ctx.TableExists("Split_Groups")) return;
                  var isPg = ctx.Provider == DatabaseProvider.PostgreSQL;
                  var idType = isPg ? "SERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";
                  var numType = isPg ? "NUMERIC(18,2)" : "DECIMAL(18,2)";
                  var dateType = isPg ? "TIMESTAMP" : "DATETIME";
                  ctx.Execute($@"CREATE TABLE split_groups (
                      id {idType},
                      owneruserid BIGINT NULL,
                      groupuid VARCHAR(50) NOT NULL,
                      title VARCHAR(250) NOT NULL,
                      description VARCHAR(1000) NULL,
                      date {dateType} NOT NULL,
                      totalamount {numType} NOT NULL,
                      usershareamount {numType} NOT NULL,
                      settledamount {numType} NOT NULL,
                      status VARCHAR(50) NOT NULL,
                      confidence VARCHAR(50) NULL,
                      splittype VARCHAR(50) NULL,
                      parentaccountid BIGINT NULL,
                      parentbankreference VARCHAR(100) NULL,
                      parentbanktype VARCHAR(50) NULL,
                      parenttransactiontype VARCHAR(10) NULL,
                      createdon {dateType} NOT NULL,
                      updatedon {dateType} NULL
                  )");
              })
              .AddStep("Guard: split_group_members table", ctx =>
              {
                  if (ctx.TableExists("split_group_members") || ctx.TableExists("Split_Group_Members")) return;
                  var isPg = ctx.Provider == DatabaseProvider.PostgreSQL;
                  var idType = isPg ? "SERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";
                  var numType = isPg ? "NUMERIC(18,2)" : "DECIMAL(18,2)";
                  var dateType = isPg ? "TIMESTAMP" : "DATETIME";
                  var boolType = isPg ? "BOOLEAN" : "INTEGER";
                  ctx.Execute($@"CREATE TABLE split_group_members (
                      id {idType},
                      owneruserid BIGINT NULL,
                      splitgroupid INT NOT NULL,
                      participantname VARCHAR(250) NOT NULL,
                      participantvpa VARCHAR(255) NULL,
                      assignedamount {numType} NOT NULL,
                      paidamount {numType} NOT NULL,
                      issettled {boolType} NOT NULL,
                      isuser {boolType} NOT NULL,
                      linkedaccountid BIGINT NULL,
                      linkedbankreference VARCHAR(100) NULL,
                      linkedbanktype VARCHAR(50) NULL,
                      linkedtransactiontype VARCHAR(10) NULL,
                      notes VARCHAR(1000) NULL,
                      createdon {dateType} NOT NULL
                  )");
              });

            // ── Version 5 ────────────────────────────────────────────────────────────
            // Persistent GPay-style groups with multiple splits & member tracking
            mb.ForVersion(5)
              .AddStep("Guard: bill_groups table", ctx =>
              {
                  if (ctx.TableExists("bill_groups") || ctx.TableExists("Bill_Groups")) return;
                  var isPg = ctx.Provider == DatabaseProvider.PostgreSQL;
                  var idType = isPg ? "SERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";
                  var dateType = isPg ? "TIMESTAMP" : "DATETIME";
                  ctx.Execute($@"CREATE TABLE bill_groups (
                      id {idType},
                      owneruserid BIGINT NULL,
                      name VARCHAR(250) NOT NULL,
                      description VARCHAR(1000) NULL,
                      createdon {dateType} NOT NULL,
                      updatedon {dateType} NULL
                  )");
              })
              .AddStep("Guard: bill_group_members table", ctx =>
              {
                  if (ctx.TableExists("bill_group_members") || ctx.TableExists("Bill_Group_Members")) return;
                  var isPg = ctx.Provider == DatabaseProvider.PostgreSQL;
                  var idType = isPg ? "SERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";
                  var dateType = isPg ? "TIMESTAMP" : "DATETIME";
                  ctx.Execute($@"CREATE TABLE bill_group_members (
                      id {idType},
                      owneruserid BIGINT NULL,
                      billgroupid INT NOT NULL,
                      name VARCHAR(250) NOT NULL,
                      vpa VARCHAR(255) NULL,
                      createdon {dateType} NOT NULL
                  )");
              })
              .AddStep("Guard: billgroupid and groupname on split_groups", ctx =>
              {
                  if (!ctx.ColumnExists("split_groups", "billgroupid"))
                  {
                      ctx.Execute("ALTER TABLE split_groups ADD COLUMN billgroupid INT NULL");
                  }
                  if (!ctx.ColumnExists("split_groups", "groupname"))
                  {
                      ctx.Execute("ALTER TABLE split_groups ADD COLUMN groupname VARCHAR(250) NULL");
                  }
              });

            mb.ForVersion(6).AddStep("Google Pay source evidence and allocations", ctx => {
                var pg = ctx.Provider == DatabaseProvider.PostgreSQL;
                var id = pg ? "SERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";
                var date = pg ? "TIMESTAMP" : "DATETIME";
                foreach (var column in new[] { "sourcekey VARCHAR(64)", "sourcestate VARCHAR(50)", "creatorname VARCHAR(250)", "sourcesnapshot TEXT", $"sourceimportedutc {date}" }) {
                    var name = column.Split(' ')[0];
                    if (!ctx.ColumnExists("split_groups", name)) ctx.Execute($"ALTER TABLE split_groups ADD COLUMN {column} NULL");
                }
                foreach (var column in new[] { "sourcestate VARCHAR(50)", "settlementevidence VARCHAR(50)" }) {
                    if (!ctx.ColumnExists("split_group_members", column.Split(' ')[0])) ctx.Execute($"ALTER TABLE split_group_members ADD COLUMN {column} NULL");
                }
                if (!ctx.TableExists("gpay_evidence_records")) {
                    ctx.Execute($"CREATE TABLE gpay_evidence_records (id {id}, owneruserid BIGINT NOT NULL, kind VARCHAR(40) NOT NULL, sourcekey VARCHAR(64) NOT NULL, payload TEXT NOT NULL, createdutc {date} NOT NULL)");

                }

                ctx.Execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_gpay_evidence_source ON gpay_evidence_records(owneruserid,kind,sourcekey)");
                ctx.Execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_gpay_expense_source ON split_groups(owneruserid,sourcekey)");
                if (!ctx.TableExists("gpay_settlement_allocations")) {
                    ctx.Execute($"CREATE TABLE gpay_settlement_allocations (id {id}, owneruserid BIGINT NOT NULL, splitid INT NOT NULL, memberid INT NOT NULL, accountid BIGINT NOT NULL, bankreference VARCHAR(100) NOT NULL, banktype VARCHAR(50) NOT NULL, transactiontype VARCHAR(10) NOT NULL, amount NUMERIC(18,2) NOT NULL, createdutc {date} NOT NULL)");

                }
                ctx.Execute("CREATE INDEX IF NOT EXISTS ix_gpay_alloc_transaction ON gpay_settlement_allocations(owneruserid,accountid,bankreference,banktype,transactiontype)");
            });
            mb.ForVersion(7).AddStep("Separate Google Pay export profiles", ctx => {
                if (!ctx.ColumnExists("split_groups", "gpayprofileid")) ctx.Execute("ALTER TABLE split_groups ADD COLUMN gpayprofileid VARCHAR(64) NULL");
                if (!ctx.ColumnExists("split_groups", "gpayownername")) ctx.Execute("ALTER TABLE split_groups ADD COLUMN gpayownername VARCHAR(250) NULL");
                if (!ctx.ColumnExists("bill_groups", "gpayprofileid")) ctx.Execute("ALTER TABLE bill_groups ADD COLUMN gpayprofileid VARCHAR(64) NULL");
            });
        }
    }
}
