using Common.Framework.Auth;
using Common.Framework.Tenancy.Postgres;
using Npgsql;

namespace BankStatementAnalytics.Tenancy;

/// <summary>Offline, stopped-writes copy. Shared source rows are never deleted.</summary>
public static class LegacySchemaMigration
{
    private static string Predicate(string table, bool owned) => owned ? "s.owneruserid=@user" : table switch {
        "bank_transactions" or "cardstatementsummaries" or "importhistory" or "uploads" => "s.accountid in(select id from public.accounts where owneruserid=@user)",
        "merchantupis" or "counterpartyaliases" => "s.counterpartyid in(select id from public.merchant where owneruserid=@user)",
        "merchantaccounts" => "s.counterpartyid in(select id from public.merchant where owneruserid=@user) and s.accountid in(select id from public.accounts where owneruserid=@user)",
        "subcategories" => "s.categoryid in(select id from public.categories where owneruserid=@user)",
        "uploadtransactions" => "s.id in(select transactionid from public.uploads where accountid in(select id from public.accounts where owneruserid=@user))",
        _ => throw new InvalidOperationException("No audited ownership rule for legacy table: "+table)
    };
    public static async Task CopyUserAsync(long userId,CancellationToken token=default)
    {
        if(AuthService.GetUser(userId)==null) throw new InvalidOperationException("Existing user required.");
        var subject=userId.ToString(System.Globalization.CultureInfo.InvariantCulture);
        var tenant=await AppTenantRuntime.Store.ProvisionAsync(new("user",subject),subject,token);
        await AppTenantRuntime.Store.RunDataMigrationAsync(tenant,"bank-financial-legacy-copy-v1","bank-financial-legacy-copy-v1",async (context,cancellation)=>{
            await context.ExecuteAsync("set constraints all deferred",cancellation);
            foreach(var table in AppTenantRuntime.Definition.Tables) {
                await using var exists=new NpgsqlCommand("select exists(select 1 from information_schema.tables where table_schema='public' and table_name=@table)",context.Connection,context.Transaction);
                exists.Parameters.AddWithValue("table",table);
                if(await exists.ExecuteScalarAsync(cancellation) is not true) continue;
                await using var owner=new NpgsqlCommand("select exists(select 1 from information_schema.columns where table_schema='public' and table_name=@table and column_name='owneruserid')",context.Connection,context.Transaction);
                owner.Parameters.AddWithValue("table",table);
                var owned=await owner.ExecuteScalarAsync(cancellation) is true;
                var predicate=Predicate(table,owned);
                var source=TenantIdentifiers.Qualified("public",table); var target=context.Table(table);
                var columns=new List<string>();
                await using(var columnCommand=new NpgsqlCommand("select column_name from information_schema.columns where table_schema=@schema and table_name=@table order by ordinal_position",context.Connection,context.Transaction)) {
                    columnCommand.Parameters.AddWithValue("schema",tenant.Schema); columnCommand.Parameters.AddWithValue("table",table);
                    await using var columnReader=await columnCommand.ExecuteReaderAsync(cancellation);
                    while(await columnReader.ReadAsync(cancellation)) columns.Add(columnReader.GetString(0));
                }
                var sourceColumns=new HashSet<string>();
                await using(var columnCommand=new NpgsqlCommand("select column_name from information_schema.columns where table_schema='public' and table_name=@table",context.Connection,context.Transaction)) {
                    columnCommand.Parameters.AddWithValue("table",table);
                    await using var columnReader=await columnCommand.ExecuteReaderAsync(cancellation);
                    while(await columnReader.ReadAsync(cancellation)) sourceColumns.Add(columnReader.GetString(0));
                }
                if(!sourceColumns.SetEquals(columns)) throw new InvalidOperationException("Legacy table columns differ from the supported model: "+table+". Upgrade/inspect the shared schema before copying.");
                var quotedColumns=string.Join(",",columns.Select(TenantIdentifiers.Quote));
                var projection=string.Join(",",columns.Select(c=>"s."+TenantIdentifiers.Quote(c)));
                // Reject orphaned/unowned rows rather than assigning private records by guesswork.
                await using(var orphan=new NpgsqlCommand($"select count(*) from {source} s where not exists(select 1 from public.users u where ({predicate.Replace("@user","u.id")}))",context.Connection,context.Transaction)) {
                    if(Convert.ToInt64(await orphan.ExecuteScalarAsync(cancellation))!=0) throw new InvalidOperationException("Legacy ownership is ambiguous in "+table+". Repair ownership before migration.");
                }
                await using(var empty=new NpgsqlCommand($"select count(*) from {target}",context.Connection,context.Transaction)) {
                    if(Convert.ToInt64(await empty.ExecuteScalarAsync(cancellation))!=0) throw new InvalidOperationException("Target schema is not empty; refusing to mix legacy and new data.");
                }
                await using var copy=new NpgsqlCommand($"insert into {target}({quotedColumns}) overriding system value select {projection} from {source} s where {predicate}",context.Connection,context.Transaction);
                copy.Parameters.AddWithValue("user",userId); await copy.ExecuteNonQueryAsync(cancellation);
                await using var compare=new NpgsqlCommand($"select exists((select {projection} from {source} s where {predicate} except all select {quotedColumns} from {target}) union all (select {quotedColumns} from {target} except all select {projection} from {source} s where {predicate}))",context.Connection,context.Transaction);
                compare.Parameters.AddWithValue("user",userId);
                if(await compare.ExecuteScalarAsync(cancellation) is true) throw new InvalidOperationException("Legacy copy verification failed for "+table);
            }
            await AppTenantRuntime.Store.ResetSequencesAsync(context.Connection,context.Transaction,tenant,cancellation);
            // Copy only files referenced by this user's imported upload rows. Keep originals for rollback.
            using var userScope=AppTenantRuntime.Context.Enter(AppTenantRuntime.Identity(userId),tenant);
            await using var uploads=new NpgsqlCommand($"select storedname from {context.Table("uploads")} where storedname is not null and storedname<>''",context.Connection,context.Transaction);
            await using var reader=await uploads.ExecuteReaderAsync(cancellation);
            var sourceStore=new Common.Framework.Deployment.RootedFileStore(Services.UploadStorage.BaseRoot,"Invalid legacy file path.");
            var targetStore=new Common.Framework.Deployment.RootedFileStore(Services.UploadStorage.Root,"Invalid tenant file path.");
            while(await reader.ReadAsync(cancellation)) {
                var name=reader.GetString(0); var oldPath=sourceStore.ResolvePath(name);
                if(!File.Exists(oldPath)) throw new InvalidOperationException("A referenced legacy upload is missing. Restore it before migration.");
                var destination=targetStore.ResolvePath(name); Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                if(File.Exists(destination)) {
                    if(!System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(oldPath)).SequenceEqual(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(destination)))) throw new InvalidOperationException("Tenant upload conflicts with legacy file.");
                } else File.Copy(oldPath,destination);
            }
        },token);
    }
}
