using Common.Framework.Auth;
using Common.Framework.Tenancy.Postgres;
using Npgsql;

namespace BankStatementAnalytics.Tenancy;

public static class TenantOperatorCommands
{
    public static async Task RunAsync(string[] args,CancellationToken token=default)
    {
        if(!AppTenantRuntime.Enabled) throw new InvalidOperationException("Set Tenancy:Enabled=true for schema operator commands.");
        if(args.Length<2) throw new ArgumentException("Use schema-tenancy init|migrate|list|backup|restore.");
        if(args[1]!="repair-roles") _=NHibernateHelper.SessionFactory;
        switch(args[1]) {
            case "init": await AppTenantRuntime.Store.InitializeAsync(token); Console.WriteLine("Dedicated-database tenancy metadata initialized. Financial data was not copied."); break;
            case "migrate":
                if(!args.Contains("--stopped-writes",StringComparer.Ordinal)) throw new InvalidOperationException("Stop every application writer and acknowledge with --stopped-writes after taking an external backup.");
                await AppTenantRuntime.Store.InitializeAsync(token);
                using(var session=Common.Framework.Data.DbHelper.GetSession()) {
                    foreach(var user in session.Query<AppUser>().OrderBy(u=>u.Id).ToList()) await LegacySchemaMigration.CopyUserAsync(user.Id,token);
                }
                await HardenSharedRoleAsync(token);
                await AppTenantRuntime.Store.SetApplicationMarkerAsync("financial-cutover-v1","complete",token);
                Console.WriteLine("User copies verified. Shared source rows retained. Authentication role isolated. Start all instances with tenancy enabled.");
                break;
            case "list": foreach(var tenant in await AppTenantRuntime.Store.ListAsync(token)) Console.WriteLine($"{tenant.Id} {tenant.Schema} {tenant.State}"); break;
            case "repair-roles":
                await AppTenantRuntime.Store.RepairRolesAsync(token); await HardenSharedRoleAsync(token);
                Console.WriteLine("Tenant roles and authentication grants recovered using the restored key ring."); break;
            case "backup":
                if(args.Length!=4 || !long.TryParse(args[2],out var userId)) throw new ArgumentException("Use schema-tenancy backup <user-id> <new-output-file>.");
                var bytes=await AppTenantRuntime.Store.BackupAsync(AppTenantRuntime.Identity(userId),token);
                await using(var file=new FileStream(args[3],FileMode.CreateNew,FileAccess.Write,FileShare.None)) await file.WriteAsync(bytes,token);
                Console.WriteLine("Encrypted single-user database snapshot written. Preserve Data Protection keys and original upload files separately."); break;
            case "restore":
                if(args.Length!=4 || !long.TryParse(args[2],out var restoreId)) throw new ArgumentException("Use schema-tenancy restore <user-id> <snapshot-file>.");
                await AppTenantRuntime.Store.RestoreAsync(AppTenantRuntime.Identity(restoreId),await File.ReadAllBytesAsync(args[3],token),token);
                Console.WriteLine("Selected user's database snapshot restored. Other users were not restored."); break;
            default: throw new ArgumentException("Unknown schema tenancy operator command.");
        }
    }
    internal static async Task HardenSharedRoleAsync(CancellationToken token)
    {
        var auth=new NpgsqlConnectionStringBuilder(NHibernateHelper.Describe().ConnectionString);
        await using var connection=new NpgsqlConnection(AppTenantRuntime.OperatorConnectionString); await connection.OpenAsync(token);
        await using var transaction=await connection.BeginTransactionAsync(token);
        await using var current=new NpgsqlCommand("select current_user",connection,transaction);
        var operatorName=(string)(await current.ExecuteScalarAsync(token))!;
        if(operatorName==auth.Username) throw new InvalidOperationException("Authentication and operator roles must be different.");
        var quote=new NpgsqlCommandBuilder(); var authRole=quote.QuoteIdentifier(auth.Username!); var operatorRole=quote.QuoteIdentifier(operatorName);
        await using(var privilege=new NpgsqlCommand("select rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls from pg_roles where rolname=@role",connection,transaction)) {
            privilege.Parameters.AddWithValue("role",auth.Username!);
            if(await privilege.ExecuteScalarAsync(token) is not false) throw new InvalidOperationException("Authentication role must already be non-administrative. Do not use an operator/superuser as the application account.");
        }
        foreach(var table in AppTenantRuntime.Definition.Tables) {
            var source=TenantIdentifiers.Qualified("public",table);
            await using var exists=new NpgsqlCommand("select to_regclass(@table) is not null",connection,transaction); exists.Parameters.AddWithValue("table",source);
            if(await exists.ExecuteScalarAsync(token) is true) {
                await using var alter=new NpgsqlCommand($"alter table {source} owner to {operatorRole}; revoke all on {source} from {authRole},public",connection,transaction); await alter.ExecuteNonQueryAsync(token);
            }
        }
        await using var harden=new NpgsqlCommand($"alter database {quote.QuoteIdentifier(connection.Database)} owner to {operatorRole}; alter schema public owner to {operatorRole}; revoke all on schema public from public,{authRole}; grant usage on schema public to {authRole}; grant connect on database {quote.QuoteIdentifier(connection.Database)} to {authRole}",connection,transaction);
        await harden.ExecuteNonQueryAsync(token);
        await using(var authGrants=new NpgsqlCommand($"grant select,insert,update,delete on public.users,public.external_logins to {authRole}; grant usage,select on sequence public.users_id_seq to {authRole}",connection,transaction)) await authGrants.ExecuteNonQueryAsync(token);
        await transaction.CommitAsync(token);
    }
}
