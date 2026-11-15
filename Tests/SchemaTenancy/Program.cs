using System.Security.Claims;
using Common.Framework.Tenancy.Postgres;
using Microsoft.AspNetCore.DataProtection;
using NHibernate.Cfg;
using NHibernate.Mapping.ByCode;
using NHibernate.Mapping.ByCode.Conformist;
using Npgsql;
using Environment = System.Environment;

if (args.Length == 2 && args[0] == "write-baseline") {
    File.WriteAllText(args[1],new BankStatementAnalytics.Tenancy.AppTenantSchema(generateBaseline:true).GenerateBaseline());
    Console.WriteLine("Generated initial financial baseline from actual NHibernate mappings."); return;
}

var connectionString = Environment.GetEnvironmentVariable("TENANCY_TEST_CONNECTION") ?? throw new Exception("Set TENANCY_TEST_CONNECTION to a disposable PostgreSQL database.");
if (Environment.GetEnvironmentVariable("BSA_DISPOSABLE_TEST") != "yes") throw new Exception("Set BSA_DISPOSABLE_TEST=yes; never use a live database.");
await using (var guard = new NpgsqlConnection(connectionString)) {
    await guard.OpenAsync();
    if (!guard.Database.StartsWith("tenant_test_",StringComparison.Ordinal)) throw new Exception("Disposable database name must start tenant_test_.");
}
var keys = Path.Combine(Path.GetTempPath(),"tenant-test-keys-"+Guid.NewGuid().ToString("N"));
var protection = DataProtectionProvider.Create(new DirectoryInfo(keys),builder=>builder.SetApplicationName("BankStatementAnalytics.Auth"));
var options = new PostgresTenantOptions { OperatorConnectionString=connectionString, MaximumPoolSize=1 };
var definition = new TestDefinition();
var store = new PostgresTenantStore(options,definition,protection);
if(args.Length==2 && args[0]=="provision-worker") {
    var sharedProtection=DataProtectionProvider.Create(new DirectoryInfo(args[1]),builder=>builder.SetApplicationName("BankStatementAnalytics.Auth"));
    var worker=new PostgresTenantStore(options,definition,sharedProtection);
    await worker.ProvisionAsync(new("user","synthetic-distributed"),"synthetic-distributed");
    return;
}
await store.InitializeAsync();
var checks = 0;
void Check(bool value,string text) { if (!value) throw new Exception(text); checks++; Console.WriteLine("PASS: "+text); }
ClaimsPrincipal Principal(string subject,string? organization=null) {
    var claims = new List<Claim> { new(ClaimTypes.NameIdentifier,subject) };
    if (organization != null) claims.Add(new("organization_id",organization));
    return new(new ClaimsIdentity(claims,"synthetic-auth"));
}
var alice = Principal("synthetic-alice"); var bob = Principal("synthetic-bob");
var provisioned = await Task.WhenAll(Enumerable.Range(0,6).Select(_ => new PostgresTenantStore(options,definition,protection).ProvisionAsync(new("user","synthetic-alice"),"synthetic-alice")));
Check(provisioned.Select(t=>t.Id).Distinct().Count()==1,"multiple instances provision one schema and role atomically");
var a = provisioned[0]; var b = await store.ProvisionAsync(new("user","synthetic-bob"),"synthetic-bob");
await Task.WhenAll(Enumerable.Range(0,4).Select(async _=>{
    var processInfo=new System.Diagnostics.ProcessStartInfo(Environment.ProcessPath!) {UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};
    if(Path.GetFileNameWithoutExtension(Environment.ProcessPath!).Equals("dotnet",StringComparison.OrdinalIgnoreCase)) processInfo.ArgumentList.Add(typeof(TestDefinition).Assembly.Location);
    processInfo.ArgumentList.Add("provision-worker"); processInfo.ArgumentList.Add(keys);
    using var process=System.Diagnostics.Process.Start(processInfo)!;
    var stdout=process.StandardOutput.ReadToEndAsync(); var stderr=process.StandardError.ReadToEndAsync();
    await process.WaitForExitAsync(); await stdout;
    if(process.ExitCode!=0) throw new Exception("Distributed worker failed: "+await stderr);
}));
Check((await store.ListAsync()).Count(t=>t.Key.Value=="synthetic-distributed")==1,"separate OS processes coordinate provisioning through PostgreSQL");
Check(a.Schema != b.Schema && a.Role != b.Role,"users receive distinct schemas and database roles");
try { TenantIdentifiers.Quote("x\"; drop schema public;--"); throw new Exception("injection accepted"); } catch (ArgumentException) { Check(true,"SQL identifier injection rejected"); }
try { await store.ResolveAsync(new ClaimsPrincipal(new ClaimsIdentity())); throw new Exception("anonymous accepted"); } catch (UnauthorizedAccessException) { Check(true,"anonymous context rejected"); }
try { await store.ProvisionAsync(new("user","synthetic-alice"),"synthetic-bob"); throw new Exception("membership claimed"); } catch (UnauthorizedAccessException) { Check(true,"provisioning existing tenant cannot grant unauthorized membership"); }
var mapper = new ModelMapper(); mapper.AddMapping<LedgerMap>();
var cfg = new Configuration();
cfg.DataBaseIntegration(db=>{ db.Driver<NHibernate.Driver.NpgsqlDriver>(); db.Dialect<NHibernate.Dialect.PostgreSQL83Dialect>(); db.ConnectionString="Host=localhost;Database=unused;Username=unused"; });
cfg.AddMapping(mapper.CompileMappingForAllExplicitlyAddedEntities());
var context = new TenantExecutionContext();
string aliceCache;
using(context.Enter(alice,a)) aliceCache=context.CacheKey("ledger:1");
using(context.Enter(bob,b)) Check(context.CacheKey("ledger:1")!=aliceCache,"cache keys include verified tenant identity");
var releaseChild=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
Task<bool> child;
using(context.Enter(alice,a)) child=Task.Run(async ()=>{await releaseChild.Task; return context.HasScope;});
releaseChild.SetResult();
Check(!await child,"background tasks cannot retain a disposed request scope");
using var sessions = new PostgresTenantSessions(cfg,store,context);
foreach (var (principal,tenant,label) in new[] {(alice,a,"alice-data"),(bob,b,"bob-data")}) {
    using var scope = context.Enter(principal,tenant);
    using var session = sessions.OpenSession(); using var tx = session.BeginTransaction();
    await session.SaveAsync(new Ledger { Label=label }); await tx.CommitAsync();
}
for (var iteration=0; iteration<8; iteration++) {
    await Task.WhenAll(new[] {(alice,a,"alice-data"),(bob,b,"bob-data")}.Select(async item=>{
        using var scope = context.Enter(item.Item1,item.Item2);
        using var session = sessions.OpenSession();
        var row = await session.GetAsync<Ledger>(1L);
        if (row.Label != item.Item3) throw new Exception("NHibernate cross-tenant identity/cache leak");
    }));
}
Check(true,"concurrent sessions with identical entity IDs remain isolated with pooling");
var oldScope=context.Enter(alice,a); var oldSession=sessions.OpenSession(); var escapedQuery=oldSession.Query<Ledger>(); oldScope.Dispose();
using(context.Enter(bob,b)) {
    try { escapedQuery.ToList(); throw new Exception("Escaped tenant query succeeded"); } catch(Exception error) when(error.GetBaseException() is UnauthorizedAccessException) {Check(true,"captured ORM queries cannot execute under another tenant scope");}
}
oldSession.Dispose();
await using (var lease = await store.OpenDataConnectionAsync(alice)) {
    var connection = lease.Connection;
    foreach (var sql in new[] {$"select * from {TenantIdentifiers.Qualified(b.Schema,"ledger")}","select * from cf_tenancy.tenants","create table forbidden(id int)","create temp table forbidden(id int)", $"set role {b.Role}"}) {
        try { await new NpgsqlCommand(sql,connection).ExecuteNonQueryAsync(); throw new Exception("Unauthorized SQL succeeded"); }
        catch (PostgresException error) when (error.SqlState == "42501") { Check(true,"database rejects cross-schema, control-plane, DDL or role-switch access"); }
    }
}
var org = await store.ProvisionAsync(new("organization","synthetic-organization"),"synthetic-alice");
await using(var poison=await store.OpenDataConnectionAsync(alice)) {
    await new NpgsqlCommand($"set search_path to {b.Schema},pg_catalog",poison.Connection).ExecuteNonQueryAsync();
}
await using(var clean=await store.OpenDataConnectionAsync(alice)) {
    var label=await new NpgsqlCommand("select label from ledger where id=1",clean.Connection).ExecuteScalarAsync();
    Check((string?)label=="alice-data","pooled connection resets a previously changed search path");
}
await store.RepairRolesAsync();
await using(var repaired=await store.OpenDataConnectionAsync(alice)) {
    Check((string?)await new NpgsqlCommand("select label from ledger where id=1",repaired.Connection).ExecuteScalarAsync()=="alice-data","operator role repair preserves tenant data and pooled access");
}
await store.AddMemberAsync(org,"synthetic-bob");
Check((await store.ResolveAsync(Principal("synthetic-bob","synthetic-organization"))).Id==org.Id,"organization schemas require explicit membership");
await store.RemoveMemberAsync(org,"synthetic-bob");
try { await store.ResolveAsync(Principal("synthetic-bob","synthetic-organization")); throw new Exception("Revoked membership accepted"); } catch(UnauthorizedAccessException) {Check(true,"revoked organization membership fails closed");}
var snapshot = await store.BackupAsync(alice);
var corrupted=(byte[])snapshot.Clone(); corrupted[corrupted.Length/2]^=1;
try {await store.RestoreAsync(alice,corrupted); throw new Exception("Tampered snapshot accepted");}
catch(System.Security.Cryptography.CryptographicException) {Check(true,"tampered snapshots fail before replacing tenant data");}
using (context.Enter(alice,a)) {
    using var session = sessions.OpenSession(); using var tx = session.BeginTransaction();
    (await session.GetAsync<Ledger>(1L)).Label="changed"; await tx.CommitAsync();
}
try { await store.RestoreAsync(bob,snapshot); throw new Exception("cross-user restore accepted"); } catch (System.Security.Cryptography.CryptographicException) { Check(true,"snapshot cannot restore into another user's schema"); }
await store.RestoreAsync(alice,snapshot);
using (context.Enter(alice,a)) { using var session = sessions.OpenSession(); Check((await session.GetAsync<Ledger>(1L)).Label=="alice-data","tenant restore recovers only its own data"); }
using (context.Enter(bob,b)) { using var session = sessions.OpenSession(); Check((await session.GetAsync<Ledger>(1L)).Label=="bob-data","another user's records survive tenant restore"); }
await Task.WhenAll(new PostgresTenantStore(options,definition,protection).MigrateAllAsync(),new PostgresTenantStore(options,definition,protection).MigrateAllAsync());
Check(true,"distributed migrations serialize and can be safely retried");
var failing=new PostgresTenantStore(options,new FailingDefinition(),protection);
try { await failing.MigrateAllAsync(); throw new Exception("Failed migration accepted"); } catch(InvalidOperationException) {
    await using var admin=new NpgsqlConnection(connectionString); await admin.OpenAsync();
    foreach(var tenant in await store.ListAsync()) {
        await using var command=new NpgsqlCommand("select to_regclass(@name) is null",admin); command.Parameters.AddWithValue("name",tenant.Schema+".rollback_probe");
        if(await command.ExecuteScalarAsync() is not true) throw new Exception("Failed migration DDL was retained");
    }
    Check(true,"failed migration rolls back DDL and records a retryable failure");
}
await store.MigrateAllAsync();
await store.SuspendAsync(b);
try { await store.OpenDataConnectionAsync(bob); throw new Exception("suspended accepted"); } catch (UnauthorizedAccessException) { Check(true,"suspended tenant cannot open database sessions"); }
await store.ResumeAsync(b);
await using(var resumed=await store.OpenDataConnectionAsync(bob)) {Check(true,"suspended tenant resumes after schema verification");}
await store.SuspendAsync(b);
await store.DeleteAsync(b);
Check(!(await store.ListAsync()).Any(t=>t.Id==b.Id),"suspended tenant schema/role lifecycle deletion");
Console.WriteLine($"Passed {checks} PostgreSQL schema tenancy checks. Synthetic key directory: {keys}");
await SecurityObjectTests.RunAsync(connectionString,protection,a);
await FinancialIntegration.RunAsync(connectionString,protection,keys);

public class Ledger { public virtual long Id { get; set; } public virtual string Label { get; set; } = ""; }
public class LedgerMap : ClassMapping<Ledger> {
    public LedgerMap() { Table("ledger"); Id(x=>x.Id,m=>m.Generator(Generators.Identity)); Property(x=>x.Label); }
}
public sealed class TestDefinition : ITenantSchemaDefinition {
    public IReadOnlyList<string> Tables => new[] {"ledger"};
    public IReadOnlyList<TenantMigration> Migrations => new[] {
        new TenantMigration(1,0,"ledger-baseline","synthetic-ledger-v1",(context,token)=>context.ExecuteAsync($"create table {context.Table("ledger")}(id bigint generated by default as identity primary key,label text not null)",token)),
        new TenantMigration(1,1,"ledger-index","synthetic-index-v1",(context,token)=>context.ExecuteAsync($"create index ledger_label on {context.Table("ledger")}(label)",token))
    };
}
public sealed class FailingDefinition : ITenantSchemaDefinition {
    public IReadOnlyList<string> Tables=>new TestDefinition().Tables;
    public IReadOnlyList<TenantMigration> Migrations=>new TestDefinition().Migrations.Concat(new[] {new TenantMigration(2,0,"failing-step","synthetic-failure-v2",async (context,token)=>{
        await context.ExecuteAsync($"create table {context.Table("rollback_probe")}(id int)",token);
        await context.ExecuteAsync("select * from deliberately_missing_migration_table",token);
    })}).ToArray();
}
