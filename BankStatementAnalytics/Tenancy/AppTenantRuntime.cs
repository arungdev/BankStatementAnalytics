using System.Security.Claims;
using Common.Framework.Auth;
using Common.Framework.Tenancy.Postgres;
using Microsoft.AspNetCore.DataProtection;
using NHibernate.Linq;

namespace BankStatementAnalytics.Tenancy;

public static class AppTenantRuntime
{
    public static bool Enabled { get; private set; }
    public static TenantExecutionContext Context { get; } = new();
    public static PostgresTenantStore Store { get; private set; } = null!;
    public static PostgresTenantSessions Sessions { get; private set; } = null!;
    public static AppTenantSchema Definition { get; private set; } = null!;
    internal static string OperatorConnectionString { get; private set; } = "";
    public static long CurrentUserId => long.Parse(Context.Principal.FindFirstValue(ClaimTypes.NameIdentifier)!,System.Globalization.CultureInfo.InvariantCulture);
    public static void Configure(IConfiguration config) {
        Enabled=config.GetValue<bool>("Tenancy:Enabled");
        if(Enabled && (!string.Equals(config["Database:Provider"],"Postgres",StringComparison.OrdinalIgnoreCase) || config.GetValue<bool>("Database:Embedded")))
            throw new InvalidOperationException("Schema tenancy requires external PostgreSQL with separate operator and authentication roles. Legacy embedded/SQLite mode remains available with Tenancy:Enabled=false.");
    }
    public static void Initialize(IServiceProvider services,IConfiguration config) {
        if(!Enabled) return;
        var operatorString=config["Tenancy:OperatorConnectionString"];
        var passwordFile=config["Tenancy:OperatorPasswordFile"];
        if(string.IsNullOrWhiteSpace(operatorString)) throw new InvalidOperationException("Configure the separate tenancy operator connection.");
        if(!string.IsNullOrWhiteSpace(passwordFile)) {
            var connection=new Npgsql.NpgsqlConnectionStringBuilder(operatorString) {Password=File.ReadAllText(passwordFile).TrimEnd('\r','\n')};
            operatorString=connection.ConnectionString;
        }
        Definition=new AppTenantSchema();
        OperatorConnectionString=operatorString;
        Store=new(new PostgresTenantOptions {OperatorConnectionString=operatorString,MetadataSchema=config["Tenancy:MetadataSchema"]??"cf_tenancy",MaximumPoolSize=config.GetValue("Tenancy:MaximumPoolSize",2),MaximumSnapshotBytes=config.GetValue("Tenancy:MaximumSnapshotBytes",32*1024*1024)},Definition,services.GetRequiredService<IDataProtectionProvider>());
        Sessions=new(Definition.Configuration,Store,Context);
    }
    public static ClaimsPrincipal Identity(long userId) => new(new ClaimsIdentity(new[] {new Claim(ClaimTypes.NameIdentifier,userId.ToString(System.Globalization.CultureInfo.InvariantCulture))},"trusted-server-operation"));
    public static IDisposable? EnterUser(long userId,bool provision=false,bool allowInactive=false) {
        if(!Enabled) return null;
        var user=AuthService.GetUser(userId);
        if(user==null || (!user.IsActive && !allowInactive)) throw new UnauthorizedAccessException("User is unavailable.");
        var principal=Identity(userId);
        var tenant=provision ? Store.ProvisionAsync(new("user",userId.ToString(System.Globalization.CultureInfo.InvariantCulture)),userId.ToString(System.Globalization.CultureInfo.InvariantCulture)).GetAwaiter().GetResult() : Store.ResolveAsync(principal).GetAwaiter().GetResult();
        return Context.Enter(principal,tenant);
    }
    public static IReadOnlyList<long> ActiveUserIds() {
        using var session=Common.Framework.Data.DbHelper.GetSession();
        return session.Query<AppUser>().Where(u=>u.IsActive).Select(u=>u.Id).ToList();
    }
    public static async Task ValidateAuthenticationRoleAsync(CancellationToken token) {
        var info=NHibernateHelper.Describe();
        await using var connection=new Npgsql.NpgsqlConnection(info.ConnectionString);
        await connection.OpenAsync(token);
        await using var command=new Npgsql.NpgsqlCommand("select rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls or (select datdba from pg_database where datname=current_database())=oid from pg_roles where rolname=current_user",connection);
        if(await command.ExecuteScalarAsync(token) is true) throw new InvalidOperationException("Schema tenancy authentication role must not administer or own the database. Run the stopped-writes schema migration/cutover command first.");
        await using var financial=new Npgsql.NpgsqlCommand("select exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(@tables) and has_table_privilege(current_user,c.oid,'SELECT'))",connection);
        financial.Parameters.AddWithValue("tables",Definition.Tables.ToArray());
        if(await financial.ExecuteScalarAsync(token) is true) throw new InvalidOperationException("Shared authentication role can still read legacy financial tables. Complete operator cutover before serving requests.");
        await using var legacy=new Npgsql.NpgsqlCommand("select exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(@tables))",connection);
        legacy.Parameters.AddWithValue("tables",Definition.Tables.ToArray());
        if(await legacy.ExecuteScalarAsync(token) is true && await Store.GetApplicationMarkerAsync("financial-cutover-v1",token)!="complete") throw new InvalidOperationException("Legacy financial migration has not completed. Refusing to serve partially copied workspaces.");
    }
}
