using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using Npgsql;

namespace Common.Framework.Tenancy.Postgres;

public sealed partial class PostgresTenantStore : IPostgresTenantStore
{
    private readonly PostgresTenantOptions _options;
    private readonly ITenantSchemaDefinition _definition;
    private readonly IDataProtectionProvider _protection;
    private readonly string _metadata;
    public PostgresTenantStore(PostgresTenantOptions options, ITenantSchemaDefinition definition, IDataProtectionProvider protection)
    {
        _options = options; _definition = definition; _protection = protection;
        _metadata = TenantIdentifiers.Quote(options.MetadataSchema);
        if (options.MaximumPoolSize is < 1 or > 20) throw new ArgumentException("Use a small per-tenant connection pool.");
        if (definition.Migrations.Any(m => m.Version < 1 || m.Order < 0 || string.IsNullOrWhiteSpace(m.Id) || string.IsNullOrWhiteSpace(m.Checksum)) ||
            definition.Migrations.Select(m => m.Id).Distinct().Count() != definition.Migrations.Count ||
            definition.Migrations.Select(m => (m.Version,m.Order)).Distinct().Count() != definition.Migrations.Count)
            throw new ArgumentException("Migration IDs and version/order pairs must be unique and checksummed.");
        foreach (var table in definition.Tables) TenantIdentifiers.Quote(table);
    }
    private IDataProtector Protector(Guid id) => _protection.CreateProtector("Common.Framework.PostgresTenant.Credential.v1", id.ToString("N"));
    private async Task<NpgsqlConnection> OperatorAsync(CancellationToken token)
    {
        var builder = new NpgsqlConnectionStringBuilder(_options.OperatorConnectionString) { MinPoolSize=0, MaxPoolSize=4, IncludeErrorDetail=false, Multiplexing=false, NoResetOnClose=false };
        var connection = new NpgsqlConnection(builder.ConnectionString);
        try { await connection.OpenAsync(token); return connection; }
        catch { await connection.DisposeAsync(); throw; }
    }
    private static async Task<int> Execute(NpgsqlConnection connection, NpgsqlTransaction? transaction, string sql, CancellationToken token, params (string, object)[] values)
    {
        await using var command = new NpgsqlCommand(sql, connection, transaction);
        foreach (var (name,value) in values) command.Parameters.AddWithValue(name,value);
        return await command.ExecuteNonQueryAsync(token);
    }
    private static async Task<string> Scalar(NpgsqlConnection connection, NpgsqlTransaction? transaction, string sql, CancellationToken token, params (string,object)[] values)
    {
        await using var command = new NpgsqlCommand(sql, connection, transaction);
        foreach (var (name,value) in values) command.Parameters.AddWithValue(name,value);
        return Convert.ToString(await command.ExecuteScalarAsync(token)) ?? "";
    }
    private static Task LockAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, string key, CancellationToken token) =>
        Execute(connection,transaction,"select pg_advisory_xact_lock(hashtextextended(@key, 1))",token,("key",key));
    private static async Task SecureCredentialDdlAsync(NpgsqlConnection connection,NpgsqlTransaction transaction,CancellationToken token)
    {
        // Credential DDL cannot use bind parameters in PostgreSQL's PASSWORD clause.
        // Require permission to suppress SQL/parameter logging before constructing it.
        await Execute(connection,transaction,"set local log_statement='none'; set local log_min_error_statement='panic'; set local log_parameter_max_length_on_error=0",token);
    }

    /// <summary>Explicit operator step for a dedicated application database, not a request-time action.</summary>
    public async Task InitializeAsync(CancellationToken token = default)
    {
        await using var connection = await OperatorAsync(token);
        if(connection.PostgreSqlVersion.Major<15) throw new InvalidOperationException("Schema tenancy requires PostgreSQL 15 or newer; PostgreSQL 16 is the verified deployment target.");
        await using var transaction = await connection.BeginTransactionAsync(token);
        await LockAsync(connection,transaction,"Common.Framework.Tenancy.Initialize",token);
        var database = new NpgsqlCommandBuilder().QuoteIdentifier(connection.Database);
        await Execute(connection,transaction,$"revoke create, temporary on database {database} from public; revoke all on schema public from public; create schema if not exists {_metadata}; revoke all on schema {_metadata} from public",token);
        if(await Scalar(connection,transaction,"select pg_get_userbyid(nspowner)=current_user from pg_namespace where nspname=@schema",token,("schema",_options.MetadataSchema))!="True") throw new InvalidOperationException("The tenancy metadata schema must be owned by the configured operator.");
        await Execute(connection,transaction,$"""
            create table if not exists {_metadata}.tenants (
                id uuid primary key, kind varchar(20) not null, identity_key varchar(200) not null,
                schema_name varchar(63) not null unique, role_name varchar(63) not null unique,
                protected_password text not null, state varchar(20) not null,
                unique(kind,identity_key));
            create table if not exists {_metadata}.memberships (
                tenant_id uuid not null references {_metadata}.tenants(id), subject varchar(200) not null,
                primary key(tenant_id,subject));
            create table if not exists {_metadata}.migrations (
                tenant_id uuid not null references {_metadata}.tenants(id), migration_id varchar(200) not null,
                version integer not null, step_order integer not null, checksum text not null,
                applied_utc timestamptz not null default now(), primary key(tenant_id,migration_id));
            create table if not exists {_metadata}.migration_failures (
                tenant_id uuid not null, recorded_utc timestamptz not null default now(), error_code varchar(100) not null);
            create table if not exists {_metadata}.settings (name varchar(200) primary key,value text not null);
            revoke all on all tables in schema {_metadata} from public;
            """,token);
        await transaction.CommitAsync(token);
    }

    public async Task<TenantDescriptor> ProvisionAsync(TenantKey key, string initialMember, CancellationToken token = default)
    {
        key.Validate(); ValidateSubject(initialMember);
        if(key.Kind=="user" && key.Value!=initialMember) throw new UnauthorizedAccessException("A user schema must belong to its initial authenticated subject.");
        await using var connection = await OperatorAsync(token);
        await using var transaction = await connection.BeginTransactionAsync(token);
        await LockAsync(connection,transaction,key.Kind+":"+key.Value,token);
        var existing = await FindAsync(connection,transaction,key,token);
        if (existing != null) {
            // Provisioning must never implicitly grant another subject an existing tenant.
            if (!await MemberAsync(connection,transaction,existing.Id,initialMember,token)) throw new UnauthorizedAccessException("Tenant membership is required.");
            await transaction.CommitAsync(token); return existing;
        }
        var id = Guid.NewGuid();
        var schema = "tn_" + id.ToString("N");
        var role = "tr_" + id.ToString("N");
        var password = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        var tenant = new TenantDescriptor(id,key,schema,role,"active");
        await SecureCredentialDdlAsync(connection,transaction,token);
        var createRole = await Scalar(connection,transaction,"select format('create role %I login password %L nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls', @role, @password)",token,("role",role),("password",password));
        await Execute(connection,transaction,createRole,token);
        await Execute(connection,transaction,$"create schema {TenantIdentifiers.Quote(schema)}; revoke all on schema {TenantIdentifiers.Quote(schema)} from public; grant connect on database {new NpgsqlCommandBuilder().QuoteIdentifier(connection.Database)} to {TenantIdentifiers.Quote(role)}",token);
        await Execute(connection,transaction,$"insert into {_metadata}.tenants values (@id,@kind,@key,@schema,@role,@password,'active'); insert into {_metadata}.memberships values (@id,@subject)",token,
            ("id",id),("kind",key.Kind),("key",key.Value),("schema",schema),("role",role),("password",Protector(id).Protect(password)),("subject",initialMember));
        await LockAsync(connection,transaction,id.ToString("N"),token);
        await ApplyMigrationsAsync(connection,transaction,tenant,token);
        await transaction.CommitAsync(token);
        return tenant;
    }
    private static void ValidateSubject(string subject)
    {
        if (string.IsNullOrWhiteSpace(subject) || subject.Length > 200 || subject.Any(char.IsControl)) throw new UnauthorizedAccessException("Invalid authenticated subject.");
    }
    private async Task<TenantDescriptor?> FindAsync(NpgsqlConnection connection, NpgsqlTransaction? transaction, TenantKey key, CancellationToken token)
    {
        await using var command = new NpgsqlCommand($"select id,schema_name,role_name,state from {_metadata}.tenants where kind=@kind and identity_key=@key",connection,transaction);
        command.Parameters.AddWithValue("kind",key.Kind); command.Parameters.AddWithValue("key",key.Value);
        await using var reader = await command.ExecuteReaderAsync(token);
        if(!await reader.ReadAsync(token)) return null;
        var tenant=new TenantDescriptor(reader.GetGuid(0),key,reader.GetString(1),reader.GetString(2),reader.GetString(3));
        ValidateStored(tenant); return tenant;
    }
    private async Task<bool> MemberAsync(NpgsqlConnection connection, NpgsqlTransaction? transaction, Guid id, string subject, CancellationToken token) =>
        await Scalar(connection,transaction,$"select count(*) from {_metadata}.memberships where tenant_id=@id and subject=@subject",token,("id",id),("subject",subject)) == "1";
    public async Task<TenantDescriptor> ResolveAsync(ClaimsPrincipal principal, CancellationToken token = default)
    {
        if (principal.Identity?.IsAuthenticated != true) throw new UnauthorizedAccessException("Authentication required.");
        var subject = principal.FindFirstValue(_options.SubjectClaim) ?? "";
        if(principal.FindAll(_options.SubjectClaim).Select(c=>c.Value).Distinct().Count()!=1 || principal.FindAll(_options.OrganizationClaim).Select(c=>c.Value).Distinct().Count()>1) throw new UnauthorizedAccessException("Ambiguous authenticated tenant identity.");
        ValidateSubject(subject);
        var organization = principal.FindFirstValue(_options.OrganizationClaim);
        var key = new TenantKey(organization == null ? "user" : "organization", organization ?? subject);
        key.Validate();
        await using var connection = await OperatorAsync(token);
        var tenant = await FindAsync(connection,null,key,token);
        if (tenant is not { State: "active" } || !await MemberAsync(connection,null,tenant.Id,subject,token)) throw new UnauthorizedAccessException("Tenant is unavailable or membership is missing.");
        return tenant;
    }
    public async Task<TenantConnectionLease> OpenDataConnectionAsync(ClaimsPrincipal principal, CancellationToken token = default)
    {
        var tenant = await ResolveAsync(principal,token);
        string password;
        await using (var admin = await OperatorAsync(token)) {
            var protectedPassword = await Scalar(admin,null,$"select protected_password from {_metadata}.tenants where id=@id",token,("id",tenant.Id));
            password = Protector(tenant.Id).Unprotect(protectedPassword);
        }
        var connection = new NpgsqlConnection(TenantConnectionString(tenant,password));
        try {
            await connection.OpenAsync(token);
            var actualRole = await Scalar(connection,null,"select current_user",token);
            if(actualRole != tenant.Role) throw new UnauthorizedAccessException("Unexpected database identity.");
            await Execute(connection,null,"select pg_advisory_lock_shared(hashtextextended(@key,1))",token,("key",tenant.Id.ToString("N")));
            // Repeat authorization after waiting for any exclusive lifecycle operation.
            if ((await ResolveAsync(principal,token)).Id != tenant.Id) throw new UnauthorizedAccessException("Tenant identity changed.");
            var unsafeRole = await Scalar(connection,null,"select (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls or has_database_privilege(current_user,current_database(),'CREATE') or has_database_privilege(current_user,current_database(),'TEMP') or has_schema_privilege(current_user,'public','USAGE') or has_schema_privilege(current_user,@schema,'CREATE') or exists(select 1 from pg_auth_members where member=(select oid from pg_roles where rolname=current_user))) from pg_roles where rolname=current_user",token,("schema",tenant.Schema));
            if (!string.Equals(unsafeRole,"False",StringComparison.OrdinalIgnoreCase)) throw new UnauthorizedAccessException("Tenant database role has unsafe privileges.");
            return new TenantConnectionLease(connection);
        } catch { await connection.DisposeAsync(); throw; }
    }
    private string TenantConnectionString(TenantDescriptor tenant,string password)
    {
        return new NpgsqlConnectionStringBuilder(_options.OperatorConnectionString) {
            Username=tenant.Role, Password=password, SearchPath="pg_catalog,"+tenant.Schema, MinPoolSize=0,
            MaxPoolSize=_options.MaximumPoolSize, Multiplexing=false, NoResetOnClose=false, IncludeErrorDetail=false,
            ApplicationName="tenant-"+tenant.Id.ToString("N"), Enlist=false
        }.ConnectionString;
    }
    public async Task SetApplicationMarkerAsync(string name,string value,CancellationToken token=default)
    {
        if(string.IsNullOrWhiteSpace(name) || name.Length>200) throw new ArgumentException("Invalid application marker.");
        await using var connection=await OperatorAsync(token);
        await Execute(connection,null,$"insert into {_metadata}.settings values(@name,@value) on conflict(name) do update set value=excluded.value",token,("name",name),("value",value));
    }
    public async Task<string> GetApplicationMarkerAsync(string name,CancellationToken token=default)
    {
        await using var connection=await OperatorAsync(token);
        return await Scalar(connection,null,$"select value from {_metadata}.settings where name=@name",token,("name",name));
    }

    private async Task ApplyMigrationsAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, TenantDescriptor tenant, CancellationToken token)
    {
        await using(var applied=new NpgsqlCommand($"select migration_id,version,step_order,checksum from {_metadata}.migrations where tenant_id=@id and version>0",connection,transaction)) {
            applied.Parameters.AddWithValue("id",tenant.Id);
            await using var reader=await applied.ExecuteReaderAsync(token);
            while(await reader.ReadAsync(token)) {
                var registered=_definition.Migrations.SingleOrDefault(m=>m.Id==reader.GetString(0));
                if(registered==null || registered.Version!=reader.GetInt32(1) || registered.Order!=reader.GetInt32(2) || registered.Checksum!=reader.GetString(3)) throw new InvalidOperationException("An applied migration was removed or modified.");
            }
        }
        await Execute(connection,transaction,$"set local search_path to {TenantIdentifiers.Quote(tenant.Schema)}, pg_catalog",token);
        foreach (var step in _definition.Migrations.OrderBy(s => s.Version).ThenBy(s => s.Order)) {
            var checksum = await Scalar(connection,transaction,$"select checksum from {_metadata}.migrations where tenant_id=@id and migration_id=@step",token,("id",tenant.Id),("step",step.Id));
            if (checksum.Length > 0) {
                if (checksum != step.Checksum) throw new InvalidOperationException("An applied tenant migration was modified.");
                continue;
            }
            await step.Apply(new(connection,transaction,tenant),token);
            await Execute(connection,transaction,$"insert into {_metadata}.migrations(tenant_id,migration_id,version,step_order,checksum) values (@id,@step,@version,@order,@checksum)",token,
                ("id",tenant.Id),("step",step.Id),("version",step.Version),("order",step.Order),("checksum",step.Checksum));
        }
        var schema = TenantIdentifiers.Quote(tenant.Schema); var role = TenantIdentifiers.Quote(tenant.Role);
        var unsafeObjects=await Scalar(connection,transaction,"select exists(select 1 from pg_proc where pronamespace=@schema::regnamespace and prosecdef) or exists(select 1 from pg_class where relnamespace=@schema::regnamespace and relkind in('m','f'))",token,("schema",tenant.Schema));
        if(unsafeObjects=="True") throw new InvalidOperationException("Tenant schemas cannot contain SECURITY DEFINER functions, materialized views or foreign tables.");
        var views=new List<string>();
        await using(var command=new NpgsqlCommand("select relname from pg_class where relnamespace=@schema::regnamespace and relkind='v'",connection,transaction)) {
            command.Parameters.AddWithValue("schema",tenant.Schema);
            await using var reader=await command.ExecuteReaderAsync(token);
            while(await reader.ReadAsync(token)) views.Add(reader.GetString(0));
        }
        foreach(var view in views) await Execute(connection,transaction,$"alter view {TenantIdentifiers.Qualified(tenant.Schema,view)} set(security_invoker=true,security_barrier=true)",token);
        await Execute(connection,transaction,$"revoke all on schema {schema} from public; revoke all on all tables in schema {schema} from public; revoke execute on all functions in schema {schema} from public; grant usage on schema {schema} to {role}; grant select,insert,update,delete on all tables in schema {schema} to {role}; grant usage,select on all sequences in schema {schema} to {role}",token);
    }
    public async Task<IReadOnlyList<TenantDescriptor>> ListAsync(CancellationToken token = default)
    {
        await using var connection = await OperatorAsync(token);
        await using var command = new NpgsqlCommand($"select id,kind,identity_key,schema_name,role_name,state from {_metadata}.tenants order by id",connection);
        await using var reader = await command.ExecuteReaderAsync(token);
        var rows = new List<TenantDescriptor>();
        while (await reader.ReadAsync(token)) {
            var tenant=new TenantDescriptor(reader.GetGuid(0),new(reader.GetString(1),reader.GetString(2)),reader.GetString(3),reader.GetString(4),reader.GetString(5));
            ValidateStored(tenant); rows.Add(tenant);
        }
        return rows;
    }
    private static void ValidateStored(TenantDescriptor tenant)
    {
        tenant.Key.Validate();
        if(tenant.Schema!="tn_"+tenant.Id.ToString("N") || tenant.Role!="tr_"+tenant.Id.ToString("N") || tenant.State is not ("active" or "suspended")) throw new InvalidOperationException("Stored tenant registry identity is invalid.");
    }
    public async Task MigrateAllAsync(CancellationToken token = default)
    {
        foreach (var tenant in await ListAsync(token)) {
            if (tenant.State != "active") continue;
            try {
                await using var connection = await OperatorAsync(token);
                await using var transaction = await connection.BeginTransactionAsync(token);
                await LockAsync(connection,transaction,tenant.Id.ToString("N"),token);
                await ApplyMigrationsAsync(connection,transaction,tenant,token);
                await transaction.CommitAsync(token);
            } catch (Exception error) {
                await using var connection = await OperatorAsync(CancellationToken.None);
                await Execute(connection,null,$"insert into {_metadata}.migration_failures(tenant_id,error_code) values (@id,@error)",CancellationToken.None,
                    ("id",tenant.Id),("error",error is PostgresException postgres ? postgres.SqlState : error.GetType().Name));
                throw new InvalidOperationException("Tenant migration failed; prior schema version was retained. Inspect migration_failures.");
            }
        }
    }
}
