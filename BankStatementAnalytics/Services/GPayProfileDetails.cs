using System.Text.Json;
using BankStatementAnalytics.Models;
using NHibernate.Linq;

namespace BankStatementAnalytics.Services;

public sealed record GPayProfileDetailRow(string Title, decimal? Amount, DateTime? Date, string Status, string? Detail = null, List<string>? Members = null);

public partial class GPayTakeoutService
{
    private static async Task<List<(GPayEvidenceRecord Record, EvidencePayload Source)>> ProfileSourcesAsync(NHibernate.ISession session, long userId, string? profileId)
    {
        var records = await session.Query<GPayEvidenceRecord>().Where(r => r.OwnerUserId == userId && (r.Kind == "Activity" || r.Kind == "Cashback" || r.Kind == "Voucher")).ToListAsync();
        return records.Select(record => (Record: record, Source: JsonSerializer.Deserialize<EvidencePayload>(record.Payload, GPayEvidenceService.Json)!))
            .Where(entry => entry.Source.ProfileId == profileId).ToList();
    }

    private static async Task<List<ReviewSourceRequest>> ConfirmedActivityLinksAsync(NHibernate.ISession session, long userId, HashSet<int> sourceIds)
    {
        var records = await session.Query<GPayEvidenceRecord>().Where(r => r.OwnerUserId == userId && r.Kind == "Decision").ToListAsync();
        return records.Select(record => JsonSerializer.Deserialize<ReviewSourceRequest>(record.Payload, GPayEvidenceService.Json)!)
            .Where(decision => decision.Accept && sourceIds.Contains(decision.RecordId)).ToList();
    }

    public async Task<object> ProfileDetailsAsync(long userId, string? profileId, string section, int page = 0, string search = "")
    {
        profileId = string.IsNullOrWhiteSpace(profileId) || profileId == "default" ? null : profileId;
        if (profileId != null) _ = await GetProfileAsync(userId, profileId);
        if (page < 0 || (search?.Length ?? 0) > 200) throw new ArgumentException("Invalid details request.");
        using var session = Common.Framework.Data.DbHelper.GetSession();
        var rows = new List<GPayProfileDetailRow>();
        if (section == "groups") {
            var groups = await session.Query<BillGroup>().Where(g => g.OwnerUserId == userId && g.GPayProfileId == profileId).ToListAsync();
            rows.AddRange(groups.Select(group => new GPayProfileDetailRow(group.Name, null, group.CreatedOn, "Group", $"{group.Members.Count} members", group.Members.Select(member => member.Name).ToList())));
        }
        else if (section == "splits" || section == "bankMatches") {
            var splits = await session.Query<SplitGroup>().Where(g => g.OwnerUserId == userId && g.GPayProfileId == profileId).ToListAsync();
            if (section == "splits") rows.AddRange(splits.Select(split => new GPayProfileDetailRow(split.Title, split.TotalAmount, split.Date, split.Status, split.GroupName)));
            else foreach (var split in splits) {
                if (split.ParentBankReference != null) rows.Add(new(split.Title, split.TotalAmount, split.Date, "Linked", $"Account {split.ParentAccountId}; bank reference {split.ParentBankReference}"));
                rows.AddRange(split.Members.Where(member => member.LinkedBankReference != null).Select(member => new GPayProfileDetailRow(member.ParticipantName, member.PaidAmount, split.Date, "Linked", $"{split.Title}; account {member.LinkedAccountId}; bank reference {member.LinkedBankReference}")));
            }
        }
        else if (section is "upi" or "cashback" or "vouchers") {
            var sources = await ProfileSourcesAsync(session, userId, profileId);
            if (section == "upi") {
                var activities = sources.Where(entry => entry.Record.Kind == "Activity").ToDictionary(entry => entry.Record.Id);
                var links = await ConfirmedActivityLinksAsync(session, userId, activities.Keys.ToHashSet());
                foreach (var link in links) {
                    var activity = JsonSerializer.Deserialize<GPayUpiActivityItem>(activities[link.RecordId].Source.Data, GPayEvidenceService.Json)!;
                    rows.Add(new(activity.CounterPartyName ?? activity.Type, activity.Amount, activity.Timestamp, "Linked", $"Account {link.AccountId}; bank reference {link.BankReference}; GPay source {activity.RefId}"));
                }
            }
            else foreach (var entry in sources.Where(entry => entry.Record.Kind == (section == "cashback" ? "Cashback" : "Voucher")).GroupBy(entry => entry.Source.IdentityKey).Select(group => group.OrderByDescending(entry => entry.Record.Id).First())) {
                if (section == "cashback") {
                    var reward = JsonSerializer.Deserialize<GPayCashbackItem>(entry.Source.Data, GPayEvidenceService.Json)!;
                    rows.Add(new(reward.Description ?? "Cashback", reward.Amount, reward.Date, "Reward"));
                }
                else {
                    var voucher = JsonSerializer.Deserialize<GPayVoucherItem>(entry.Source.Data, GPayEvidenceService.Json)!;
                    if (voucher.IsActive) rows.Add(new(voucher.Summary, null, voucher.ExpiryTimestamp, "Active", $"{voucher.Details} · Code: {voucher.Code}"));
                }
            }
        }
        else throw new ArgumentException("Unknown profile detail section.");
        if (!string.IsNullOrWhiteSpace(search)) rows = rows.Where(row =>
            string.Join(" ", new[] { row.Title, row.Detail, row.Status }.Concat(row.Members ?? new List<string>())).Contains(search.Trim(), StringComparison.OrdinalIgnoreCase)).ToList();
        return new { Records = rows.OrderByDescending(row => row.Date).ThenBy(row => row.Title).Skip(page * 50).Take(50).ToList(), Total = rows.Count, Page = page, PageSize = 50 };
    }
}
