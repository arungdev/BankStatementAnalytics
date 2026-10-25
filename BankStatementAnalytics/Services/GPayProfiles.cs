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
    private async Task<GPayAutoImportConfigDto> LoadPrimaryConfigAsync(long userId)
    {
        using var session = DbHelper.GetSession();
        var record = await session.Query<GPayEvidenceRecord>()
            .FirstOrDefaultAsync(r => r.OwnerUserId == userId && r.Kind == "PrimaryConfig");
        if (record != null) return JsonSerializer.Deserialize<GPayAutoImportConfigDto>(record.Payload, GPayEvidenceService.Json)!;
        // The old single-user file belongs only to the original user. Never share it
        // with other tenants; preserve it on disk as a migration safety copy.
        var legacy = GetConfigFilePath();
        var firstUser = await session.Query<Common.Framework.Auth.AppUser>().OrderBy(u => u.Id).Select(u => u.Id).FirstOrDefaultAsync();
        if (userId == firstUser && File.Exists(legacy))
        {
            var config = JsonSerializer.Deserialize<GPayAutoImportConfigDto>(await File.ReadAllTextAsync(legacy), GPayEvidenceService.Json) ?? new();
            if (SecurityRuntime.PublicHosting) { config.WatchEnabled = false; config.WatchFolderPath = null; }
            return config;
        }
        return new GPayAutoImportConfigDto { WatchEnabled = false, WatchFolderPath = null };
    }
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
        if (SecurityRuntime.PublicHosting && (config.WatchEnabled || !string.IsNullOrWhiteSpace(config.WatchFolderPath)))
            throw new ArgumentException("Server watch folders are disabled for public hosting. Upload your own export instead.");
        if (config.ProfileId != null && (string.IsNullOrWhiteSpace(config.UserName) || config.UserName.Length < 2 || config.UserName.Length > 250)) throw new ArgumentException("Enter your exact name in this GPay profile.");
        using var session = DbHelper.GetSession();
        var owned = await session.Query<Account>().Where(account => account.OwnerUserId == userId).Select(account => account.Id).ToListAsync();
        if (config.BankAccountIds.Any(id => !owned.Contains(id))) throw new ArgumentException("A selected bank account is not owned by this user.");
        if (string.IsNullOrWhiteSpace(config.WatchFolderPath)) return;
        if (Common.Framework.Auth.AuthService.GetUser(userId)?.Role != Common.Framework.Auth.AppRole.Admin)
            throw new ArgumentException("Only a server administrator can configure watch folders.");
        var path = Path.GetFullPath(config.WatchFolderPath).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var records = await session.Query<GPayEvidenceRecord>().Where(record => record.OwnerUserId == userId && record.Kind == "Profile").ToListAsync();
        var others = records.Select(record => JsonSerializer.Deserialize<GPayAutoImportConfigDto>(record.Payload, GPayEvidenceService.Json)!).Where(profile => profile.ProfileId != config.ProfileId).ToList();
        if (config.ProfileId != null)
        {
            others.Add(await LoadPrimaryConfigAsync(userId));
        }
        if (others.Any(profile => !string.IsNullOrWhiteSpace(profile.WatchFolderPath) && string.Equals(Path.GetFullPath(profile.WatchFolderPath).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar), path, StringComparison.OrdinalIgnoreCase)))
            throw new ArgumentException("Each GPay profile needs a separate export folder to prevent cross-profile imports.");
    }

    private async Task SaveProfileConfigAsync(long userId, GPayAutoImportConfigDto config, bool create = false)
    {
        // Summary lists are response-only; avoid nesting profiles in saved configuration.
        var snapshot = JsonSerializer.Deserialize<GPayAutoImportConfigDto>(JsonSerializer.Serialize(config))!;
        snapshot.Profiles.Clear();
        using var gate = await ImportAccountGate.AcquireAsync(-userId);
        using var session = DbHelper.GetSession();
        using var transaction = session.BeginTransaction();
        var kind = config.ProfileId == null ? "PrimaryConfig" : "Profile";
        var key = GPayEvidenceService.Hash(config.ProfileId ?? "primary-config");
        var record = await session.Query<GPayEvidenceRecord>().FirstOrDefaultAsync(record => record.OwnerUserId == userId && record.Kind == kind && record.SourceKey == key);
        if (record == null && !create && config.ProfileId != null) throw new ArgumentException("GPay profile not found.");
        if (record == null) await session.SaveAsync(new GPayEvidenceRecord { OwnerUserId = userId, Kind = kind, SourceKey = key, Payload = JsonSerializer.Serialize(snapshot) });
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
            if (!record.OwnerUserId.HasValue || Common.Framework.Auth.AuthService.GetUser(record.OwnerUserId.Value)?.Role != Common.Framework.Auth.AppRole.Admin
                || !profile.WatchEnabled || string.IsNullOrWhiteSpace(profile.WatchFolderPath) || !Directory.Exists(profile.WatchFolderPath)) continue;
            var latest = Directory.EnumerateFiles(profile.WatchFolderPath, "*.*", SearchOption.TopDirectoryOnly).Where(file => file.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) || file.EndsWith(".json", StringComparison.OrdinalIgnoreCase)).Select(file => new FileInfo(file)).OrderByDescending(file => file.LastWriteTimeUtc).FirstOrDefault();
            if (latest != null && (!profile.LastSyncUtc.HasValue || latest.LastWriteTimeUtc > profile.LastSyncUtc.Value)) await SweepAsync(record.OwnerUserId.Value, profile.ProfileId);
        }
    }
}
