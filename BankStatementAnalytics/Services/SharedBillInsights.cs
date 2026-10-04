using BankStatementAnalytics.Models;
using Common.Framework.Data;
using NHibernate.Linq;

namespace BankStatementAnalytics.Services;

// Read-only projections of the same balances used on the Bill Splits page.
public static class SharedBillInsights
{
    public static SharedBillSummary Summarize(IEnumerable<SplitGroupDetailDto> groups,
        IEnumerable<GPaySettlementAllocation> allocations, HashSet<long>? accountIds = null,
        DateTime? startDate = null, DateTime? endDate = null)
    {
        var validAllocations = ValidAllocations(groups, allocations);
        var scoped = groups.Where(g =>
            (!startDate.HasValue || g.Date.Date >= startDate.Value.Date) &&
            (!endDate.HasValue || g.Date.Date <= endDate.Value.Date) &&
            (accountIds == null ||
                (g.ParentAccountId.HasValue && accountIds.Contains(g.ParentAccountId.Value) && !string.IsNullOrEmpty(g.ParentBankReference)) ||
                g.Members.Any(m => m.LinkedAccountId.HasValue && accountIds.Contains(m.LinkedAccountId.Value) && !string.IsNullOrEmpty(m.LinkedBankReference)) ||
                validAllocations.Any(a => a.SplitId == g.Id && accountIds.Contains(a.AccountId))))
            .ToList();
        return new(scoped.Count, scoped.Sum(g => g.TotalAmount), scoped.Sum(g => g.UserShareAmount),
            scoped.Sum(g => g.SettledAmount), scoped.Sum(g => g.VerifiedAmount),
            scoped.Where(g => g.IsCreatedByUser).Sum(g => g.PendingAmount),
            scoped.Where(g => !g.IsCreatedByUser).Sum(g => g.PendingAmount),
            scoped.Where(g => g.PendingAmount > 0).OrderByDescending(g => g.PendingAmount)
                .ThenByDescending(g => g.Date).ThenBy(g => g.Id).Select(g => new SharedBillRow(
                    g.Id, g.Title, g.GroupName, g.Date, g.IsCreatedByUser, g.PendingAmount)).ToList());
    }

    public static List<SharedBillTransactionContext> ForTransaction(IEnumerable<SplitGroupDetailDto> groups,
        IEnumerable<GPaySettlementAllocation> allocations, long accountId, string reference, string bankType, string transactionType)
    {
        bool Matches(long? account, string? bankRef, string? bank, string? type) =>
            !string.IsNullOrEmpty(reference) && !string.IsNullOrEmpty(bankType) && !string.IsNullOrEmpty(transactionType) &&
            account == accountId && bankRef == reference && bank == bankType && type == transactionType;
        var validAllocations = ValidAllocations(groups, allocations);
        var result = new List<SharedBillTransactionContext>();
        foreach (var group in groups)
        {
            if (Matches(group.ParentAccountId, group.ParentBankReference, group.ParentBankType, group.ParentTransactionType))
                result.Add(new(group.Id, group.Title, group.GroupName, "Bill payment", null, null,
                    group.UserShareAmount, group.PendingAmount, group.IsCreatedByUser, null));
            foreach (var member in group.Members)
            {
                var allocated = validAllocations.Where(a => a.SplitId == group.Id && a.MemberId == member.Id &&
                    Matches(a.AccountId, a.BankReference, a.BankType, a.TransactionType)).ToList();
                if (allocated.Count == 0 && !Matches(member.LinkedAccountId, member.LinkedBankReference,
                    member.LinkedBankType, member.LinkedTransactionType)) continue;
                result.Add(new(group.Id, group.Title, group.GroupName, member.IsUser ? "My repayment" : "Participant repayment",
                    member.ParticipantName, allocated.Count > 0 ? allocated.Sum(a => a.Amount) : null,
                    group.UserShareAmount, group.PendingAmount, group.IsCreatedByUser, member.SettlementEvidence));
            }
        }
        return result;
    }

    private static List<GPaySettlementAllocation> ValidAllocations(IEnumerable<SplitGroupDetailDto> groups,
        IEnumerable<GPaySettlementAllocation> allocations)
    {
        var members = groups.SelectMany(g => g.Members.Select(m => (g.Id, m.Id))).ToHashSet();
        return allocations.Where(a => a.Amount > 0 && members.Contains((a.SplitId, a.MemberId))).ToList();
    }
}

public record SharedBillRow(int Id, string Title, string? GroupName, DateTime Date, bool IsCreatedByUser, decimal PendingAmount);
public record SharedBillSummary(int BillCount, decimal TotalBillVolume, decimal MyShare, decimal RecordedSettlements,
    decimal BankVerified, decimal ToCollect, decimal OwedByMe, List<SharedBillRow> OutstandingBills);
public record SharedBillTransactionContext(int SplitId, string Title, string? GroupName, string Role,
    string? ParticipantName, decimal? AllocatedAmount, decimal MyShare, decimal PendingAmount,
    bool IsCreatedByUser, string? SettlementEvidence);

public partial class GPaySplitService
{
    public async Task<SharedBillSummary> GetSharedBillSummaryAsync(long userId, HashSet<long>? accountIds,
        DateTime? startDate, DateTime? endDate)
    {
        var groups = await GetGroupsAsync(userId);
        using var session = DbHelper.GetSession();
        var allocations = await session.Query<GPaySettlementAllocation>().Where(a => a.OwnerUserId == userId).ToListAsync();
        return SharedBillInsights.Summarize(groups, allocations, accountIds, startDate, endDate);
    }

    public async Task<List<SharedBillTransactionContext>?> GetSharedBillTransactionContextAsync(long userId,
        long accountId, string reference, string bankType, string transactionType)
    {
        using var session = DbHelper.GetSession();
        var ownedIds = AccountAccess.OwnedIdSet(session, userId);
        if (!ownedIds.Contains(accountId) || !await session.Query<BankTransaction>().AnyAsync(t =>
            t.AccountId == accountId && t.BankReference == reference && t.BankType == bankType && t.TransactionType == transactionType)) return null;
        var groups = await GetGroupsAsync(userId);
        var allocations = await session.Query<GPaySettlementAllocation>().Where(a => a.OwnerUserId == userId).ToListAsync();
        return SharedBillInsights.ForTransaction(groups, allocations, accountId, reference, bankType, transactionType);
    }
}
