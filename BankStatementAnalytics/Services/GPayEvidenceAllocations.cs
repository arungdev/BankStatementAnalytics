using BankStatementAnalytics.Models;
using Common.Framework.Data;
using NHibernate;
using NHibernate.Linq;
using System.Text.Json;

namespace BankStatementAnalytics.Services;

public sealed partial class GPayEvidenceService
{
    public async Task Allocate(long userId, AllocateRepaymentRequest req)
    {
        if (req.Amount <= 0 || decimal.Round(req.Amount, 2) != req.Amount) throw new ArgumentException("Allocation must be positive and in whole paise.");
        using var session = DbHelper.GetSession(); using var transaction = session.BeginTransaction();
        var ids = AccountAccess.OwnedIds(session, userId);
        var payment = await session.Query<BankTransaction>().FirstOrDefaultAsync(t => ids.Contains(t.AccountId) && t.AccountId == req.AccountId && t.BankReference == req.BankReference && t.BankType == req.BankType && t.TransactionType == req.TransactionType && t.TransferGroupId == null) ?? throw new ArgumentException("Owned bank transaction not found.");
        await session.LockAsync(payment, LockMode.Upgrade);
        if (payment.Mode == "TRANSFER") throw new ArgumentException("Own-account transfer is not a repayment.");
        var m = await session.Query<SplitGroupMember>().FirstOrDefaultAsync(m => m.OwnerUserId == userId && m.Id == req.MemberId && m.Group.Id == req.SplitId) ?? throw new ArgumentException("Participant not found.");
        await session.LockAsync(m.Group,LockMode.Upgrade);
        await session.LockAsync(m, LockMode.Upgrade); await session.RefreshAsync(m);
        var names = await OwnerNames(session,userId); var credit = IsCreator(m.Group,names); var self = IsSelf(m,names);
        if (credit == self || (credit ? payment.Credit : payment.Debit) <= 0) throw new ArgumentException("Use incoming credit for someone who owes you, or outgoing debit for your own obligation to another creator.");
        var allocations = await session.Query<GPaySettlementAllocation>().Where(a => a.OwnerUserId == userId && a.AccountId == req.AccountId && a.BankReference == req.BankReference && a.BankType == req.BankType && a.TransactionType == req.TransactionType).ToListAsync();
        var legacy = await session.Query<SplitGroupMember>().Where(x => x.OwnerUserId == userId && x.LinkedAccountId == req.AccountId && x.LinkedBankReference == req.BankReference && x.LinkedBankType == req.BankType && x.LinkedTransactionType == req.TransactionType).ToListAsync();
        if (legacy.Any()) throw new ArgumentException("Transaction has a legacy link. Unlink it before allocating; existing links are preserved until reviewed.");
        var parents=await session.Query<SplitGroup>().AnyAsync(g=>g.OwnerUserId==userId&&g.ParentAccountId==req.AccountId&&g.ParentBankReference==req.BankReference&&g.ParentBankType==req.BankType&&g.ParentTransactionType==req.TransactionType);
        if(parents)throw new ArgumentException("This transaction is already reserved as a bill payment.");
        var memberAllocated = (await session.Query<GPaySettlementAllocation>().Where(a => a.OwnerUserId == userId && a.MemberId == m.Id).ToListAsync()).Sum(a=>a.Amount);
        if (m.LinkedBankReference != null) throw new ArgumentException("Participant has a legacy link; unlink it before allocating.");
        if (allocations.Sum(a=>a.Amount) + req.Amount > (credit ? payment.Credit : payment.Debit)) throw new ArgumentException("Allocation exceeds the bank transaction's remaining capacity.");
        if (memberAllocated + req.Amount > m.AssignedAmount) throw new ArgumentException("Allocation exceeds the participant's assigned amount.");
        await session.SaveAsync(new GPaySettlementAllocation { OwnerUserId=userId, SplitId=m.Group.Id, MemberId=m.Id, AccountId=payment.AccountId, BankReference=payment.BankReference, BankType=payment.BankType, TransactionType=payment.TransactionType, Amount=req.Amount });
        await session.SaveAsync(new GPayEvidenceRecord {OwnerUserId=userId,Kind="AllocationAudit",SourceKey=Hash(Guid.NewGuid().ToString()),Payload=JsonSerializer.Serialize(new{Action="Allocate",req.SplitId,req.MemberId,req.AccountId,req.BankReference,req.BankType,req.TransactionType,req.Amount})});
        m.PaidAmount = memberAllocated + req.Amount; m.IsSettled=m.PaidAmount >= m.AssignedAmount; m.SettlementEvidence="Bank verified allocation"; await session.UpdateAsync(m);
        Recalculate(m.Group,names); await session.UpdateAsync(m.Group); await transaction.CommitAsync();
    }

    public async Task RemoveAllocation(long userId, int id)
    {
        using var session=DbHelper.GetSession();using var tx=session.BeginTransaction();
        var a=await session.Query<GPaySettlementAllocation>().FirstOrDefaultAsync(a=>a.OwnerUserId==userId&&a.Id==id) ?? throw new ArgumentException("Allocation not found.");
        var m=await session.Query<SplitGroupMember>().FirstOrDefaultAsync(m=>m.OwnerUserId==userId&&m.Id==a.MemberId) ?? throw new ArgumentException("Participant not found.");
        await session.LockAsync(m.Group,LockMode.Upgrade); await session.LockAsync(m,LockMode.Upgrade);
        await session.SaveAsync(new GPayEvidenceRecord {OwnerUserId=userId,Kind="AllocationAudit",SourceKey=Hash(Guid.NewGuid().ToString()),Payload=JsonSerializer.Serialize(new{Action="Remove allocation",a.Id,a.SplitId,a.MemberId,a.AccountId,a.BankReference,a.BankType,a.TransactionType,a.Amount})});
        await session.DeleteAsync(a); await session.FlushAsync();
        var remaining=(await session.Query<GPaySettlementAllocation>().Where(a=>a.OwnerUserId==userId&&a.MemberId==m.Id).ToListAsync()).Sum(a=>a.Amount);
        m.PaidAmount=remaining>0?remaining:IsPaid(m.SourceState)?m.AssignedAmount:0;m.IsSettled=m.PaidAmount>=m.AssignedAmount;
        m.SettlementEvidence=remaining>0?"Bank verified allocation":Evidence(m.SourceState);await session.UpdateAsync(m);
        Recalculate(m.Group,await OwnerNames(session,userId));await session.UpdateAsync(m.Group);await tx.CommitAsync();
    }
}
