using System.Security.Cryptography;
using System.Text;
using Common.Framework.Tenancy.Postgres;
using NHibernate.Cfg;
using NHibernate.Mapping.ByCode;

namespace BankStatementAnalytics.Tenancy;

public sealed class AppTenantSchema : ITenantSchemaDefinition
{
    public Configuration Configuration { get; }
    public IReadOnlyList<string> Tables { get; }
    public IReadOnlyList<TenantMigration> Migrations { get; }
    public AppTenantSchema(bool generateBaseline = false) {
        var mapper=new ModelMapper(); NHibernateHelper.AddFinancialMappings(mapper);
        Configuration=new Configuration();
        Configuration.DataBaseIntegration(db=>{
            db.Driver<NHibernate.Driver.NpgsqlDriver>(); db.Dialect<NHibernate.Dialect.PostgreSQL83Dialect>();
            // All sessions receive an authorized external tenant connection.
            db.ConnectionString="Host=localhost;Database=unused;Username=unused";
            db.BatchSize=50;
        });
        Configuration.AddMapping(mapper.CompileMappingForAllExplicitlyAddedEntities());
        Configuration.BuildMappings();
        Tables=Configuration.ClassMappings.Select(m=>m.Table.Name).Concat(Configuration.CollectionMappings.Select(m=>m.CollectionTable.Name)).Select(n=>n.ToLowerInvariant()).Distinct().Order().ToArray();
        string[] sql;
        if (generateBaseline) sql=Configuration.GenerateSchemaCreationScript(new NHibernate.Dialect.PostgreSQL83Dialect());
        else {
            using var stream=typeof(AppTenantSchema).Assembly.GetManifestResourceStream("BankStatementAnalytics.Tenancy.financial-baseline.sql") ?? throw new InvalidOperationException("Tenant baseline migration resource missing.");
            using var reader=new StreamReader(stream);
            sql=reader.ReadToEnd().Replace("\r\n","\n").Split("\n-- cf:statement --\n",StringSplitOptions.RemoveEmptyEntries);
        }
        sql=sql.Select(statement=>statement.Trim()).Where(statement=>statement.Length>0).ToArray();
        var checksum=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(string.Join("\n",sql))));
        Migrations=new[] {new TenantMigration(1,0,"financial-baseline-v1",checksum,async (context,token)=>{
            foreach(var statement in sql) await context.ExecuteAsync(statement,token);
        })};
    }
    public string GenerateBaseline() {
        var statements=Configuration.GenerateSchemaCreationScript(new NHibernate.Dialect.PostgreSQL83Dialect())
            .Select(sql=>sql.Contains("foreign key",StringComparison.OrdinalIgnoreCase) ? sql+" deferrable initially deferred" : sql)
            .Append("create index if not exists ix_banktransactions_account_effectivedate on bank_transactions(accountid,coalesce(effectivedate,transactiondate))");
        return string.Join("\n-- cf:statement --\n",statements);
    }
}
