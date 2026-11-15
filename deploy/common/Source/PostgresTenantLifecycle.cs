using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Npgsql;

namespace Common.Framework.Tenancy.Postgres;

public sealed partial class PostgresTenantStore
{
    private readonly SemaphoreSlim _snapshotGate=new(1,1);
    private async Task<IDisposable> AcquireSnapshotAsync(CancellationToken token)
    {
        await _snapshotGate.WaitAsync(token); return new SnapshotLease(_snapshotGate);
    }
    private sealed class SnapshotLease(SemaphoreSlim gate):IDisposable {
        private int _disposed;
        public void Dispose(){if(Interlocked.Exchange(ref _disposed,1)==0) gate.Release();}
    }
    /// <summary>Trusted operator-only application data migration, coordinated across instances.</summary>
    public async Task RunDataMigrationAsync(TenantDescriptor tenant,string id,string checksum,Func<TenantMigrationContext,CancellationToken,Task> migration,CancellationToken token=default)
    {
        if(string.IsNullOrWhiteSpace(id) || id.Length>200 || string.IsNullOrWhiteSpace(checksum)) throw new ArgumentException("Migration identity required.");
        await using var connection=await OperatorAsync(token);
        await using var transaction=await connection.BeginTransactionAsync(token);
        await LockAsync(connection,transaction,tenant.Id.ToString("N"),token);
        var stored=await FindAsync(connection,transaction,tenant.Key,token);
        if(stored?.Id!=tenant.Id || stored.State!="active") throw new InvalidOperationException("Stored active tenant required.");
        var previous=await Scalar(connection,transaction,$"select checksum from {_metadata}.migrations where tenant_id=@id and migration_id=@step",token,("id",stored.Id),("step",id));
        if(previous.Length>0) { if(previous!=checksum) throw new InvalidOperationException("Data migration checksum changed."); await transaction.CommitAsync(token); return; }
        await migration(new(connection,transaction,stored),token);
        await Execute(connection,transaction,$"insert into {_metadata}.migrations(tenant_id,migration_id,version,step_order,checksum) values (@id,@step,0,0,@checksum)",token,("id",stored.Id),("step",id),("checksum",checksum));
        await transaction.CommitAsync(token);
    }
    /// <summary>Operator-only membership changes; never bind these arguments to public HTTP requests.</summary>
    public async Task AddMemberAsync(TenantDescriptor tenant, string subject, CancellationToken token = default)
    {
        ValidateSubject(subject);
        await using var connection = await OperatorAsync(token);
        var stored=await FindAsync(connection,null,tenant.Key,token);
        if (stored?.Id!=tenant.Id || stored.Key.Kind != "organization") throw new InvalidOperationException("Only stored organization workspaces can add members.");
        await Execute(connection,null,$"insert into {_metadata}.memberships values (@id,@subject) on conflict do nothing",token,("id",tenant.Id),("subject",subject));
    }
    public async Task SuspendAsync(TenantDescriptor tenant, CancellationToken token = default)
    {
        await using var connection = await OperatorAsync(token);
        await using var transaction = await connection.BeginTransactionAsync(token);
        await LockAsync(connection,transaction,tenant.Id.ToString("N"),token);
        var stored=await FindAsync(connection,transaction,tenant.Key,token);
        if(stored?.Id!=tenant.Id) throw new InvalidOperationException("Stored tenant required.");
        await Execute(connection,transaction,$"alter role {TenantIdentifiers.Quote(stored.Role)} nologin",token);
        await Execute(connection,transaction,$"update {_metadata}.tenants set state='suspended' where id=@id",token,("id",tenant.Id));
        await transaction.CommitAsync(token);
    }
    public async Task RemoveMemberAsync(TenantDescriptor tenant,string subject,CancellationToken token=default)
    {
        ValidateSubject(subject);
        await using var connection=await OperatorAsync(token); await using var transaction=await connection.BeginTransactionAsync(token);
        await LockAsync(connection,transaction,tenant.Id.ToString("N"),token);
        await Execute(connection,transaction,$"delete from {_metadata}.memberships where tenant_id=@id and subject=@subject",token,("id",tenant.Id),("subject",subject));
        await transaction.CommitAsync(token);
    }
    public async Task ResumeAsync(TenantDescriptor tenant,CancellationToken token=default)
    {
        await using var connection=await OperatorAsync(token); await using var transaction=await connection.BeginTransactionAsync(token);
        await LockAsync(connection,transaction,tenant.Id.ToString("N"),token);
        var stored=await FindAsync(connection,transaction,tenant.Key,token);
        if(stored?.Id!=tenant.Id || stored.State!="suspended") throw new InvalidOperationException("Stored suspended tenant required.");
        await ApplyMigrationsAsync(connection,transaction,stored,token);
        await Execute(connection,transaction,$"alter role {TenantIdentifiers.Quote(stored.Role)} login; update {_metadata}.tenants set state='active' where id=@id",token,("id",stored.Id));
        await transaction.CommitAsync(token);
    }
    /// <summary>Explicit operator recovery after trusted --no-owner/--no-acl full database restoration.</summary>
    public async Task RepairRolesAsync(CancellationToken token=default)
    {
        foreach(var tenant in await ListAsync(token)) {
            if(tenant.Schema!="tn_"+tenant.Id.ToString("N") || tenant.Role!="tr_"+tenant.Id.ToString("N")) throw new InvalidOperationException("Registry contains an unexpected generated identity.");
            await using var connection=await OperatorAsync(token); await using var transaction=await connection.BeginTransactionAsync(token);
            await LockAsync(connection,transaction,tenant.Id.ToString("N"),token);
            await SecureCredentialDdlAsync(connection,transaction,token);
            var protectedPassword=await Scalar(connection,transaction,$"select protected_password from {_metadata}.tenants where id=@id",token,("id",tenant.Id));
            var password=Protector(tenant.Id).Unprotect(protectedPassword);
            var exists=await Scalar(connection,transaction,"select exists(select 1 from pg_roles where rolname=@role)",token,("role",tenant.Role));
            if(exists=="True") {
                var unsafeRole=await Scalar(connection,transaction,"select rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls or exists(select 1 from pg_auth_members where member=pg_roles.oid) from pg_roles where rolname=@role",token,("role",tenant.Role));
                if(unsafeRole!="False") throw new InvalidOperationException("Existing recovery role has unsafe privileges; manual review required.");
            }
            var statement=exists=="True" ? "select format('alter role %I login password %L',@role,@password)" : "select format('create role %I login password %L nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls',@role,@password)";
            var ddl=await Scalar(connection,transaction,statement,token,("role",tenant.Role),("password",password));
            await Execute(connection,transaction,ddl,token);
            await Execute(connection,transaction,$"grant connect on database {new NpgsqlCommandBuilder().QuoteIdentifier(connection.Database)} to {TenantIdentifiers.Quote(tenant.Role)}",token);
            if(tenant.State=="suspended") await Execute(connection,transaction,$"alter role {TenantIdentifiers.Quote(tenant.Role)} nologin",token);
            await ApplyMigrationsAsync(connection,transaction,tenant,token);
            await transaction.CommitAsync(token);
            using var pool=new NpgsqlConnection(TenantConnectionString(tenant,password)); NpgsqlConnection.ClearPool(pool);
        }
    }
    public async Task DeleteAsync(TenantDescriptor tenant, CancellationToken token = default)
    {
        await using var connection = await OperatorAsync(token);
        await using var transaction = await connection.BeginTransactionAsync(token);
        await LockAsync(connection,transaction,tenant.Id.ToString("N"),token);
        var stored = await FindAsync(connection,transaction,tenant.Key,token);
        if (stored?.Id != tenant.Id || stored.State != "suspended") throw new InvalidOperationException("Suspend and back up the stored tenant before deletion.");
        // Names come from the registry, not caller-provided descriptor fields.
        await Execute(connection,transaction,$"drop schema {TenantIdentifiers.Quote(stored.Schema)} cascade; revoke all on database {new NpgsqlCommandBuilder().QuoteIdentifier(connection.Database)} from {TenantIdentifiers.Quote(stored.Role)}; drop role {TenantIdentifiers.Quote(stored.Role)}",token);
        await Execute(connection,transaction,$"delete from {_metadata}.migrations where tenant_id=@id; delete from {_metadata}.memberships where tenant_id=@id; delete from {_metadata}.tenants where id=@id",token,("id",stored.Id));
        await transaction.CommitAsync(token);
    }

    private sealed record LogicalSnapshot(Guid Tenant, int Format, Dictionary<string,string> Versions, Dictionary<string,List<JsonElement>> Tables);
    private IDataProtector SnapshotProtector(Guid id) => _protection.CreateProtector("Common.Framework.PostgresTenant.Snapshot.v1",id.ToString("N"));
    public async Task<byte[]> BackupAsync(ClaimsPrincipal principal, CancellationToken token = default)
    {
        using var snapshotLease=await AcquireSnapshotAsync(token);
        var tenant = await ResolveAsync(principal,token);
        await using var connection = await OperatorAsync(token);
        await using var transaction = await connection.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead,token);
        await LockAsync(connection,transaction,tenant.Id.ToString("N"),token);
        if((await ResolveAsync(principal,token)).Id!=tenant.Id) throw new UnauthorizedAccessException("Tenant membership changed.");
        var tables = new Dictionary<string,List<JsonElement>>();
        var bytes = 0;
        foreach (var table in _definition.Tables) {
            var rows = new List<JsonElement>();
            await using var command = new NpgsqlCommand($"select row_to_json(t)::text from {TenantIdentifiers.Qualified(tenant.Schema,table)} t",connection,transaction);
            await using var reader = await command.ExecuteReaderAsync(token);
            while (await reader.ReadAsync(token)) {
                var json = reader.GetString(0); bytes += System.Text.Encoding.UTF8.GetByteCount(json);
                if (bytes > _options.MaximumSnapshotBytes) throw new InvalidOperationException("Tenant snapshot exceeds the configured size limit.");
                rows.Add(JsonSerializer.Deserialize<JsonElement>(json));
            }
            tables.Add(table,rows);
        }
        var versions = await VersionsAsync(connection,transaction,tenant.Id,token);
        var snapshot = JsonSerializer.SerializeToUtf8Bytes(new LogicalSnapshot(tenant.Id,1,versions,tables));
        if (snapshot.Length > _options.MaximumSnapshotBytes) throw new InvalidOperationException("Tenant snapshot exceeds the configured size limit.");
        await transaction.CommitAsync(token);
        return SnapshotProtector(tenant.Id).Protect(snapshot);
    }
    private async Task<Dictionary<string,string>> VersionsAsync(NpgsqlConnection connection,NpgsqlTransaction transaction,Guid tenant,CancellationToken token)
    {
        await using var command = new NpgsqlCommand($"select migration_id,checksum from {_metadata}.migrations where tenant_id=@id and version>0",connection,transaction);
        command.Parameters.AddWithValue("id",tenant);
        await using var reader = await command.ExecuteReaderAsync(token);
        var versions = new Dictionary<string,string>();
        while (await reader.ReadAsync(token)) versions.Add(reader.GetString(0),reader.GetString(1));
        return versions;
    }
    /// <summary>Authenticated, tenant-bound data restore. No SQL from an archive is executed.</summary>
    public async Task RestoreAsync(ClaimsPrincipal principal, byte[] protectedSnapshot, CancellationToken token = default)
    {
        using var snapshotLease=await AcquireSnapshotAsync(token);
        if (protectedSnapshot.Length > _options.MaximumSnapshotBytes + 1024) throw new InvalidOperationException("Snapshot too large.");
        var tenant = await ResolveAsync(principal,token);
        var clear = SnapshotProtector(tenant.Id).Unprotect(protectedSnapshot);
        var snapshot = JsonSerializer.Deserialize<LogicalSnapshot>(clear) ?? throw new InvalidOperationException("Invalid snapshot.");
        if (snapshot.Tenant != tenant.Id || snapshot.Format != 1 || !snapshot.Tables.Keys.Order().SequenceEqual(_definition.Tables.Order())) throw new InvalidOperationException("Snapshot tenant or table set does not match.");
        await using var connection = await OperatorAsync(token);
        await using var transaction = await connection.BeginTransactionAsync(token);
        await LockAsync(connection,transaction,tenant.Id.ToString("N"),token);
        var versions = await VersionsAsync(connection,transaction,tenant.Id,token);
        if((await ResolveAsync(principal,token)).Id!=tenant.Id) throw new UnauthorizedAccessException("Tenant membership changed.");
        if (versions.Count != snapshot.Versions.Count || versions.Any(v => !snapshot.Versions.TryGetValue(v.Key,out var checksum) || checksum != v.Value)) throw new InvalidOperationException("Snapshot schema version differs from the target.");
        await Execute(connection,transaction,"set constraints all deferred",token);
        await Execute(connection,transaction,"truncate table " + string.Join(",",_definition.Tables.Select(t=>TenantIdentifiers.Qualified(tenant.Schema,t))) + " restart identity",token);
        foreach (var table in _definition.Tables) {
            var qualified = TenantIdentifiers.Qualified(tenant.Schema,table);
            foreach (var row in snapshot.Tables[table])
                await Execute(connection,transaction,$"insert into {qualified} overriding system value select (jsonb_populate_record(null::{qualified},@row::jsonb)).*",token,("row",row.GetRawText()));
        }
        await ResetSequencesAsync(connection,transaction,tenant,token);
        await transaction.CommitAsync(token);
    }
    public async Task ResetSequencesAsync(NpgsqlConnection connection,NpgsqlTransaction transaction,TenantDescriptor tenant,CancellationToken token = default)
    {
        foreach (var table in _definition.Tables) {
            var qualified = TenantIdentifiers.Qualified(tenant.Schema,table);
            await using var command = new NpgsqlCommand("select column_name from information_schema.columns where table_schema=@schema and table_name=@table and (column_default like 'nextval(%' or is_identity='YES')",connection,transaction);
            command.Parameters.AddWithValue("schema",tenant.Schema); command.Parameters.AddWithValue("table",table);
            var columns = new List<string>();
            await using (var reader = await command.ExecuteReaderAsync(token)) { while(await reader.ReadAsync(token)) columns.Add(reader.GetString(0)); }
            foreach (var column in columns) {
                var quoted = TenantIdentifiers.Quote(column);
                await Execute(connection,transaction,$"select setval(pg_get_serial_sequence(@table,@column),coalesce((select max({quoted}) from {qualified}),1),exists(select 1 from {qualified}))",token,("table",qualified),("column",column));
            }
        }
    }
}
