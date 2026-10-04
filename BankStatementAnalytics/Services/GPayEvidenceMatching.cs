using System.Text.Json;
using System.Text.RegularExpressions;
using BankStatementAnalytics.Models;
using Common.Framework.Data;
using NHibernate.Linq;
using NHibernate;

namespace BankStatementAnalytics.Services;

public sealed partial class GPayEvidenceService
{
    public async Task<object> Candidates(long userId, int? memberId, int? recordId, int days = 7)
    {
        using var session = DbHelper.GetSession(); var names = await OwnerNames(session, userId);
        decimal amount; DateTime date; bool credit; string? counterparty = null; string? suffix = null;
        if (memberId.HasValue) {
            var m = await session.Query<SplitGroupMember>().FirstOrDefaultAsync(m => m.Id == memberId && m.OwnerUserId == userId) ?? throw new ArgumentException("Participant not found.");
            var own = IsCreator(m.Group, names); var self = IsSelf(m, names);
            if ((!own && !self) || (own && self)) throw new ArgumentException("This allocation is not an owner repayment flow.");
            if (m.SourceState is "MARK_AS_PAID" or "FAILED" || m.Group.Status is "Closed" or "Cancelled") throw new ArgumentException("Closed, failed or manually adjusted allocations require manual bank review.");
            amount = m.AssignedAmount; date = m.Group.Date; credit = own; counterparty = own ? m.ParticipantName : Creator(m.Group);
        } else {
            var r = await session.Query<GPayEvidenceRecord>().FirstOrDefaultAsync(r => r.Id == recordId && r.OwnerUserId == userId) ?? throw new ArgumentException("Source record not found.");
            var data = JsonSerializer.Deserialize<EvidencePayload>(r.Payload, Json)!.Data;
            string? status;
            if (r.Kind == "Activity") { var a = JsonSerializer.Deserialize<GPayUpiActivityItem>(data, Json)!; amount = a.Amount; date = a.Timestamp; credit = a.Type == "Received"; counterparty = a.CounterPartyName; suffix = a.AccountSuffix; status = a.Status; }
            else if (r.Kind == "Cashback") { var a = JsonSerializer.Deserialize<GPayCashbackItem>(data, Json)!; amount = a.Amount; date = a.Date; credit = true; counterparty = "Google"; status = "Completed"; }
            else if (r.Kind == "Order") { var a = JsonSerializer.Deserialize<GPayOrderTransactionItem>(data, Json)!; amount = a.Amount; date = a.Time; credit = false; counterparty = a.Description; status = a.Status == "Complete" && a.PaymentMethod != "Google Play balance" ? "Completed" : "Ineligible"; }
            else throw new ArgumentException("This source does not support bank matching.");
            if (status != "Completed") return new { Candidates = Array.Empty<object>(), Reason = "Only completed bank-funded records are eligible. Missing status is not success." };
        }
        var accounts = await session.Query<Account>().Where(a => a.OwnerUserId == userId).ToListAsync(); var ids = accounts.Select(a => a.Id).ToList();
        var txs = await session.Query<BankTransaction>().Where(t => ids.Contains(t.AccountId) && t.TransferGroupId == null).ToListAsync();
        var links = await session.Query<SplitGroupMember>().Where(m => m.OwnerUserId == userId && m.LinkedBankReference != null).ToListAsync();
        var allocations = await session.Query<GPaySettlementAllocation>().Where(a => a.OwnerUserId == userId).ToListAsync();
        var decisions = (await session.Query<GPayEvidenceRecord>().Where(r=>r.OwnerUserId==userId&&r.Kind=="Decision").ToListAsync()).ToDictionary(r=>r.SourceKey,r=>JsonSerializer.Deserialize<ReviewSourceRequest>(r.Payload,Json)!);
        var suffixAccounts = suffix == null ? new List<Account>() : accounts.Where(a => a.AccountNumber?.EndsWith(suffix) == true).ToList();
        var window = Math.Clamp(days, 1, 90);
        var candidates = txs.Where(t => t.Mode != "TRANSFER" && (credit ? t.Credit : t.Debit) == amount && Math.Abs((t.TransactionDate.Date - date.Date).Days) <= window && (suffix == null || suffixAccounts.Count == 1 && t.AccountId == suffixAccounts[0].Id)).Select(t => {
            var key = TxKey(t.AccountId, t.BankReference, t.BankType, t.TransactionType);
            var used = links.Any(m => TxKey(m.LinkedAccountId ?? 0, m.LinkedBankReference!, m.LinkedBankType ?? "", m.LinkedTransactionType ?? "") == key && m.Id != memberId) || allocations.Any(a => TxKey(a.AccountId,a.BankReference,a.BankType,a.TransactionType) == key);
            var text = Normalize(t.Description + " " + t.Narration + " " + t.UpiVpa + " " + t.CounterParty?.Name);
            var tokens = Regex.Split(Normalize(counterparty), @"[^\p{L}\p{N}]+").Where(s => s.Length >= 3).ToList();
            var nameMatches = tokens.Count > 0 && tokens.All(text.Contains);
            decisions.TryGetValue(Hash($"{recordId}|{t.AccountId}|{t.BankReference}|{t.BankType}|{t.TransactionType}"),out var decision);
            return new { t.AccountId, t.BankReference, t.BankType, t.TransactionType, t.TransactionDate, t.Description, Amount = credit ? t.Credit : t.Debit, Used = used, Decision=decision==null?"Unreviewed":decision.Accept?"Confirmed":"Rejected", Confidence = nameMatches && suffixAccounts.Count == 1 ? "Strong suggestion" : nameMatches ? "Supported suggestion" : "Weak suggestion", NameMatches = nameMatches, Reasons = new[] { "Exact amount and direction", $"{Math.Abs((t.TransactionDate.Date-date.Date).Days)} days from source timestamp", nameMatches ? "Counterparty tokens agree" : "Counterparty unverified", suffix == null ? "No source account hint" : "Source account hint enforced", used ? "Already linked/allocated — review capacity" : "Not reserved" } };
        }).OrderBy(c => c.Used).ThenByDescending(c => c.NameMatches).ThenBy(c => Math.Abs((c.TransactionDate-date).TotalDays)).Take(20).ToList();
        return new { Candidates = candidates, Reason = "Suggestions only. No exported repayment ID proves this split relationship; confirm against the bank transaction.", SearchDays = window };
    }

    public async Task ReviewSourceMatch(long userId, ReviewSourceRequest req)
    {
        req.MatchMethod = "Manual";
        using var session = DbHelper.GetSession(); using var transaction = session.BeginTransaction();
        var source = await session.Query<GPayEvidenceRecord>().FirstOrDefaultAsync(r => r.Id == req.RecordId && r.OwnerUserId == userId) ?? throw new ArgumentException("Source not found.");
        var key = Hash($"{source.Id}|{req.AccountId}|{req.BankReference}|{req.BankType}|{req.TransactionType}");
        if (req.Accept) {
            var accounts = AccountAccess.OwnedIds(session, userId);
            var bank = await session.Query<BankTransaction>().FirstOrDefaultAsync(t => accounts.Contains(t.AccountId) && t.AccountId == req.AccountId && t.BankReference == req.BankReference && t.BankType == req.BankType && t.TransactionType == req.TransactionType && t.TransferGroupId == null) ?? throw new ArgumentException("Owned bank transaction not found.");
            await session.LockAsync(bank, LockMode.Upgrade);
            var data = JsonSerializer.Deserialize<EvidencePayload>(source.Payload, Json)!.Data;
            decimal amount; bool credit; string description; string? suffix=null;
            if (source.Kind == "Activity") { var a = JsonSerializer.Deserialize<GPayUpiActivityItem>(data, Json)!; if (a.Status != "Completed") throw new ArgumentException("Activity is not completed."); amount = a.Amount; credit = a.Type == "Received"; suffix=a.AccountSuffix; description = $"GPay {a.Type}: {a.CounterPartyName ?? "unnamed party"}; source {a.RefId}; {a.Timestamp:O}"; }
            else if (source.Kind == "Cashback") { var a = JsonSerializer.Deserialize<GPayCashbackItem>(data, Json)!; amount=a.Amount;credit=true;description=$"Google Pay earned reward, confirmed bank credit; earned {a.Date:O}"; }
            else if (source.Kind == "Order") { var a = JsonSerializer.Deserialize<GPayOrderTransactionItem>(data, Json)!; if (a.Status != "Complete" || a.PaymentMethod == "Google Play balance") throw new ArgumentException("Order cannot prove a bank-funded purchase."); amount=a.Amount;credit=false;description=$"Google order {a.TransactionId}: {a.Description}"; }
            else throw new ArgumentException("Unsupported matching source.");
            if ((credit ? bank.Credit : bank.Debit) != amount || bank.Mode == "TRANSFER") throw new ArgumentException("Bank amount or direction differs from the source.");
            var decisions=await session.Query<GPayEvidenceRecord>().Where(r=>r.OwnerUserId==userId&&r.Kind=="Decision").ToListAsync();
            foreach(var previous in decisions) {
                var d=JsonSerializer.Deserialize<ReviewSourceRequest>(previous.Payload,Json)!;
                if(!d.Accept||d.RecordId==source.Id||d.AccountId!=req.AccountId||d.BankReference!=req.BankReference||d.BankType!=req.BankType||d.TransactionType!=req.TransactionType)continue;
                var other=await session.Query<GPayEvidenceRecord>().FirstOrDefaultAsync(r=>r.OwnerUserId==userId&&r.Id==d.RecordId);
                if(other?.Kind==source.Kind)throw new ArgumentException("This bank payment already confirms another source record of the same type. Review that decision first.");
            }
            if(suffix!=null) {var matching=await session.Query<Account>().Where(a=>a.OwnerUserId==userId).ToListAsync();var acc=matching.Where(a=>a.AccountNumber?.EndsWith(suffix)==true).ToList();if(acc.Count!=1||acc[0].Id!=bank.AccountId)throw new ArgumentException("Source account hint does not uniquely match this bank account.");}
            // Source confirmations do not overwrite merchant, category or existing notes.
            if (bank.Note?.Contains(description, StringComparison.Ordinal) != true) bank.Note = string.IsNullOrWhiteSpace(bank.Note) ? description : bank.Note + " | " + description;
            await session.UpdateAsync(bank);
        }
        var record = await session.Query<GPayEvidenceRecord>().FirstOrDefaultAsync(r => r.OwnerUserId == userId && r.Kind == "Decision" && r.SourceKey == key);
        var payload = JsonSerializer.Serialize(req);
        await session.SaveAsync(new GPayEvidenceRecord { OwnerUserId=userId,Kind="ReviewAudit",SourceKey=Hash(Guid.NewGuid().ToString()),Payload=JsonSerializer.Serialize(new { Request=req, Previous=record?.Payload, DecidedUtc=DateTime.UtcNow }) });
        if (record == null) await session.SaveAsync(new GPayEvidenceRecord { OwnerUserId=userId,Kind="Decision",SourceKey=key,Payload=payload }); else { record.Payload=payload; await session.UpdateAsync(record); }
        await transaction.CommitAsync();
    }
}
