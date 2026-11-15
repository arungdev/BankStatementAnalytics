using System.Security.Claims;
using Common.Framework.Tenancy.Postgres;
using Microsoft.AspNetCore.DataProtection;
using Npgsql;

public static class SecurityObjectTests
{
    public static async Task RunAsync(string connectionString,IDataProtectionProvider protection,TenantDescriptor source)
    {
        var options=new PostgresTenantOptions {OperatorConnectionString=connectionString,MetadataSchema="cf_view_test"};
        var definition=new ObjectDefinition(source.Schema,false);
        var store=new PostgresTenantStore(options,definition,protection); await store.InitializeAsync();
        var tenant=await store.ProvisionAsync(new("user","synthetic-view-user"),"synthetic-view-user");
        var principal=new ClaimsPrincipal(new ClaimsIdentity(new[] {new Claim(ClaimTypes.NameIdentifier,"synthetic-view-user")},"synthetic-auth"));
        await using(var lease=await store.OpenDataConnectionAsync(principal)) {
            try { await new NpgsqlCommand($"select * from {TenantIdentifiers.Qualified(tenant.Schema,"cross_view")}",lease.Connection).ExecuteNonQueryAsync(); throw new Exception("View exposed operator privileges"); }
            catch(PostgresException error) when(error.SqlState=="42501") {Console.WriteLine("PASS: owner-created view cannot expose another schema through operator privileges.");}
        }
        var unsafeStore=new PostgresTenantStore(new PostgresTenantOptions {OperatorConnectionString=connectionString,MetadataSchema="cf_function_test"},new ObjectDefinition(source.Schema,true),protection);
        await unsafeStore.InitializeAsync();
        try { await unsafeStore.ProvisionAsync(new("user","synthetic-function-user"),"synthetic-function-user"); throw new Exception("Security definer accepted"); }
        catch(InvalidOperationException) {
            if((await unsafeStore.ListAsync()).Count!=0) throw new Exception("Unsafe provisioning left a registry row.");
            Console.WriteLine("PASS: SECURITY DEFINER migration rejected and provisioning rolled back.");
        }
    }
    private sealed class ObjectDefinition(string source,bool securityDefiner) : ITenantSchemaDefinition {
        public IReadOnlyList<string> Tables=>new TestDefinition().Tables;
        public IReadOnlyList<TenantMigration> Migrations=>new TestDefinition().Migrations.Concat(new[] {
            new TenantMigration(2,0,"object-security","synthetic-object-check",(context,token)=>context.ExecuteAsync(securityDefiner
                ? $"create function {context.Table("unsafe_function")}() returns int language sql security definer as 'select 1'"
                : $"create view {context.Table("cross_view")} as select * from {TenantIdentifiers.Qualified(source,"ledger")}",token))
        }).ToArray();
    }
}
