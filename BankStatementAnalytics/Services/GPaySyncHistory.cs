using System.Text.Json;
using BankStatementAnalytics.Models;
using NHibernate.Linq;

namespace BankStatementAnalytics.Services;

public sealed record GPaySyncChange(string Kind, string Action, int? RecordId, string Description, decimal? Amount = null, string? Detail = null);
public sealed class GPaySyncRun
{
    public int Id { get; set; }
    public string? ProfileId { get; set; }
    public string Trigger { get; set; } = "";
    public string? FileName { get; set; }
    public DateTime StartedUtc { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedUtc { get; set; }
    public string Status { get; set; } = "Running";
    public string Message { get; set; } = "Sync in progress.";
    public int Added { get; set; }
    public int Updated { get; set; }
    public int Unchanged { get; set; }
    public int BankLinks { get; set; }
    public List<string> Warnings { get; set; } = new();
    public List<GPaySyncChange> Changes { get; set; } = new();
}

public partial class GPayTakeoutService
{
    private static string SyncPrefix(string? profileId) => GPayEvidenceService.Hash(profileId ?? "default")[..24] + ":";

    private async Task<GPayTakeoutImportResultDto> RecordSyncAsync(long userId, string? profileId, string trigger,
        string? fileName, Func<GPaySyncRun, Task<GPayTakeoutImportResultDto>> operation)
    {
        profileId = string.IsNullOrWhiteSpace(profileId) || profileId == "default" ? null : profileId;
        if (profileId != null) _ = await GetProfileAsync(userId, profileId);
        var run = new GPaySyncRun { ProfileId = profileId, Trigger = trigger, FileName = Path.GetFileName(fileName) };
        using (var session = Common.Framework.Data.DbHelper.GetSession()) using (var tx = session.BeginTransaction()) {
            var record = new GPayEvidenceRecord { OwnerUserId = userId, Kind = "SyncHistory", SourceKey = SyncPrefix(profileId) + Guid.NewGuid().ToString("N"), Payload = JsonSerializer.Serialize(run) };
            await session.SaveAsync(record); run.Id = record.Id;
            await tx.CommitAsync();
        }
        try {
            var result = await operation(run);
            run.Status = result.Success ? "Success" : "Failed";
            run.Message = result.Message;
            return result;
        }
        catch (Exception exception) { run.Status = "Failed"; run.Message = exception.Message; throw; }
        finally {
            run.CompletedUtc = DateTime.UtcNow;
            run.Added = run.Changes.Count(change => change.Action == "Added");
            run.Updated = run.Changes.Count(change => change.Action == "Updated");
            run.BankLinks = run.Changes.Count(change => change.Action == "Linked");
            using var session = Common.Framework.Data.DbHelper.GetSession(); using var tx = session.BeginTransaction();
            var record = await session.Query<GPayEvidenceRecord>().FirstOrDefaultAsync(r => r.Id == run.Id && r.OwnerUserId == userId && r.Kind == "SyncHistory");
            if (record != null) { record.Payload = JsonSerializer.Serialize(run); await session.UpdateAsync(record); }
            await tx.CommitAsync();
        }
    }

    public async Task<object> SyncHistoryAsync(long userId, string? profileId, int page = 0, int pageSize = 10)
    {
        profileId = string.IsNullOrWhiteSpace(profileId) || profileId == "default" ? null : profileId;
        if (profileId != null) _ = await GetProfileAsync(userId, profileId);
        if (page < 0 || pageSize < 1 || pageSize > 100) throw new ArgumentException("Invalid history page.");
        using var session = Common.Framework.Data.DbHelper.GetSession();
        var prefix = SyncPrefix(profileId);
        var query = session.Query<GPayEvidenceRecord>().Where(r => r.OwnerUserId == userId && r.Kind == "SyncHistory" && r.SourceKey.StartsWith(prefix));
        var total = await query.CountAsync();
        page = Math.Min(page, Math.Max(0, (total - 1) / pageSize));
        var records = await query.OrderByDescending(r => r.Id).Skip(page * pageSize).Take(pageSize).ToListAsync();
        var runs = records.Select(record => { var run = JsonSerializer.Deserialize<GPaySyncRun>(record.Payload, GPayEvidenceService.Json)!; run.Id = record.Id; run.Changes.Clear(); return run; }).ToList();
        return new { Runs = runs, Total = total, Page = page, PageSize = pageSize };
    }

    public async Task<object> SyncDetailsAsync(long userId, string? profileId, int id, int page = 0, int pageSize = 50)
    {
        if (page < 0 || pageSize < 1 || pageSize > 100) throw new ArgumentException("Invalid change page.");
        profileId = string.IsNullOrWhiteSpace(profileId) || profileId == "default" ? null : profileId;
        using var session = Common.Framework.Data.DbHelper.GetSession();
        var prefix = SyncPrefix(profileId);
        var record = await session.Query<GPayEvidenceRecord>().FirstOrDefaultAsync(r => r.OwnerUserId == userId && r.Kind == "SyncHistory" && r.Id == id && r.SourceKey.StartsWith(prefix))
            ?? throw new ArgumentException("Sync history not found for this profile.");
        var run = JsonSerializer.Deserialize<GPaySyncRun>(record.Payload, GPayEvidenceService.Json)!;
        run.Id = record.Id;
        var total = run.Changes.Count;
        page = Math.Min(page, Math.Max(0, (total - 1) / pageSize));
        run.Changes = run.Changes.Skip(page * pageSize).Take(pageSize).ToList();
        return new { Run = run, Total = total, Page = page, PageSize = pageSize };
    }
}
