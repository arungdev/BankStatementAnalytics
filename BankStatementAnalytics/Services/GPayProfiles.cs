using System.Text.Json;
using BankStatementAnalytics.Models;
using Common.Framework.Data;
using NHibernate.Linq;

namespace BankStatementAnalytics.Services;

public record GPayProfileSummary(string Id, string Name, string? UserName);
public class CreateGPayProfileRequest
{
    public string Name { get; set; } = "";
    public string UserName { get; set; } = "";
    public string? WatchFolderPath { get; set; }
    public List<long> BankAccountIds { get; set; } = new();
}

public partial class GPayTakeoutService
{
    public async Task<GPayAutoImportConfigDto> GetProfileAsync(long userId, string profileId)
    {
        using var session = DbHelper.GetSession();
        var key = GPayEvidenceService.Hash(profileId);
        var record = await session.Query<GPayEvidenceRecord>().FirstOrDefaultAsync(record => record.OwnerUserId == userId && record.Kind == "Profile" && record.SourceKey == key)
            ?? throw new ArgumentException("GPay profile not found.");
        return JsonSerializer.Deserialize<GPayAutoImportConfigDto>(record.Payload, GPayEvidenceService.Json)!;
    }

    public async Task<List<GPayProfileSummary>> ListProfilesAsync(long userId)
    {
        using var session = DbHelper.GetSession();
        var records = await session.Query<GPayEvidenceRecord>().Where(record => record.OwnerUserId == userId && record.Kind == "Profile").ToListAsync();
        var profiles = new List<GPayProfileSummary> { new("default", "Primary GPay", null) };
        profiles.AddRange(records.Select(record => JsonSerializer.Deserialize<GPayAutoImportConfigDto>(record.Payload, GPayEvidenceService.Json)!)
            .OrderBy(profile => profile.ProfileName).Select(profile => new GPayProfileSummary(profile.ProfileId!, profile.ProfileName, profile.UserName)));
        return profiles;
    }

    public async Task<GPayAutoImportConfigDto> CreateProfileAsync(long userId, CreateGPayProfileRequest request)
    {
        var name = request.Name.Trim();
        if (name.Length < 2 || name.Length > 100) throw new ArgumentException("Enter a profile label between 2 and 100 characters.");
        if ((await ListProfilesAsync(userId)).Any(profile => string.Equals(profile.Name, name, StringComparison.OrdinalIgnoreCase))) throw new ArgumentException("A GPay profile already uses that label.");
        var config = new GPayAutoImportConfigDto { ProfileId = Guid.NewGuid().ToString("N"), ProfileName = name, UserName = request.UserName.Trim(), WatchFolderPath = request.WatchFolderPath?.Trim().Trim('"'), BankAccountIds = request.BankAccountIds.Distinct().ToList(), WatchEnabled = false };
        await ValidateProfileConfigAsync(userId, config);
        await SaveProfileConfigAsync(userId, config, create: true);
        return await GetAutoImportConfigAsync(userId, config.ProfileId);
    }

    private async Task ValidateProfileConfigAsync(long userId, GPayAutoImportConfigDto config)
    {
        if (config.ProfileId != null && (string.IsNullOrWhiteSpace(config.UserName) || config.UserName.Length < 2 || config.UserName.Length > 250)) throw new ArgumentException("Enter your exact name in this GPay profile.");
        using var session = DbHelper.GetSession();
        var owned = await session.Query<Account>().Where(account => account.OwnerUserId == userId).Select(account => account.Id).ToListAsync();
        if (config.BankAccountIds.Any(id => !owned.Contains(id))) throw new ArgumentException("A selected bank account is not owned by this user.");
        if (string.IsNullOrWhiteSpace(config.WatchFolderPath)) return;
        var path = Path.GetFullPath(config.WatchFolderPath).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var records = await session.Query<GPayEvidenceRecord>().Where(record => record.OwnerUserId == userId && record.Kind == "Profile").ToListAsync();
        var others = records.Select(record => JsonSerializer.Deserialize<GPayAutoImportConfigDto>(record.Payload, GPayEvidenceService.Json)!).Where(profile => profile.ProfileId != config.ProfileId).ToList();
        if (config.ProfileId != null && File.Exists(GetConfigFilePath()))
        {
            var legacy = JsonSerializer.Deserialize<GPayAutoImportConfigDto>(await File.ReadAllTextAsync(GetConfigFilePath()), GPayEvidenceService.Json);
            if (legacy != null) others.Add(legacy);
        }
        else if (config.ProfileId != null) others.Add(new GPayAutoImportConfigDto { WatchFolderPath = @"D:\BankStatements\Gpay" });
        if (others.Any(profile => !string.IsNullOrWhiteSpace(profile.WatchFolderPath) && string.Equals(Path.GetFullPath(profile.WatchFolderPath).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar), path, StringComparison.OrdinalIgnoreCase)))
            throw new ArgumentException("Each GPay profile needs a separate export folder to prevent cross-profile imports.");
    }

    private async Task SaveProfileConfigAsync(long userId, GPayAutoImportConfigDto config, bool create = false)
    {
        // Summary lists are response-only; avoid nesting profiles in saved configuration.
        var snapshot = JsonSerializer.Deserialize<GPayAutoImportConfigDto>(JsonSerializer.Serialize(config))!;
        snapshot.Profiles.Clear();
        if (config.ProfileId == null)
        {
            await File.WriteAllTextAsync(GetConfigFilePath(), JsonSerializer.Serialize(snapshot, new JsonSerializerOptions { WriteIndented = true }));
            return;
        }
        using var session = DbHelper.GetSession();
        using var transaction = session.BeginTransaction();
        var key = GPayEvidenceService.Hash(config.ProfileId);
        var record = await session.Query<GPayEvidenceRecord>().FirstOrDefaultAsync(record => record.OwnerUserId == userId && record.Kind == "Profile" && record.SourceKey == key);
        if (record == null && !create) throw new ArgumentException("GPay profile not found.");
        if (record == null) await session.SaveAsync(new GPayEvidenceRecord { OwnerUserId = userId, Kind = "Profile", SourceKey = key, Payload = JsonSerializer.Serialize(snapshot) });
        else { record.Payload = JsonSerializer.Serialize(snapshot); await session.UpdateAsync(record); }
        await transaction.CommitAsync();
    }

    private async Task SweepAdditionalProfilesAsync(CancellationToken token)
    {
        using var session = DbHelper.GetSession();
        var records = await session.Query<GPayEvidenceRecord>().Where(record => record.Kind == "Profile").ToListAsync(token);
        foreach (var record in records)
        {
            token.ThrowIfCancellationRequested();
            var profile = JsonSerializer.Deserialize<GPayAutoImportConfigDto>(record.Payload, GPayEvidenceService.Json)!;
            if (!record.OwnerUserId.HasValue || !profile.WatchEnabled || string.IsNullOrWhiteSpace(profile.WatchFolderPath) || !Directory.Exists(profile.WatchFolderPath)) continue;
            var latest = Directory.EnumerateFiles(profile.WatchFolderPath, "*.*", SearchOption.TopDirectoryOnly).Where(file => file.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) || file.EndsWith(".json", StringComparison.OrdinalIgnoreCase)).Select(file => new FileInfo(file)).OrderByDescending(file => file.LastWriteTimeUtc).FirstOrDefault();
            if (latest != null && (!profile.LastSyncUtc.HasValue || latest.LastWriteTimeUtc > profile.LastSyncUtc.Value)) await SweepAsync(record.OwnerUserId.Value, profile.ProfileId);
        }
    }
}
