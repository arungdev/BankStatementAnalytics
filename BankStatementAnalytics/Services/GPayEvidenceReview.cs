using System.Text.Json;
using BankStatementAnalytics.Models;
using Common.Framework.Data;
using NHibernate;
using NHibernate.Linq;

namespace BankStatementAnalytics.Services;

public sealed partial class GPayEvidenceService
{
    public async Task<object> Workspace(long userId)
    {
        using var session = DbHelper.GetSession();
        var records = await session.Query<GPayEvidenceRecord>().Where(r => r.OwnerUserId == userId).ToListAsync();
        var groups = await session.Query<SplitGroup>().Where(g => g.OwnerUserId == userId).ToListAsync();
        var members = await session.Query<SplitGroupMember>().Where(m => m.OwnerUserId == userId).ToListAsync();
        var names = await OwnerNames(session, userId);
        var sources = records.Where(r => r.Kind == "Expense").Select(r => new { r, p = JsonSerializer.Deserialize<EvidencePayload>(r.Payload, Json)! }).GroupBy(x => x.p.IdentityKey).Select(g => g.OrderByDescending(x => x.r.CreatedUtc).ThenByDescending(x => x.r.Id).First()).ToList();
        var repairs = new List<object>();
        foreach (var source in sources) {
            var e = JsonSerializer.Deserialize<GPayExpenseItem>(source.p.Data, Json)!;
            var matches = Corresponding(groups, e);
            if (matches.Count != 1) { repairs.Add(new { RecordId = source.r.Id, SplitId = (int?)null, Title = e.Title ?? e.GroupName, Reason = matches.Count == 0 ? "No stored counterpart — import this source" : "Ambiguous source identity", Before = "", After = e.State, CanApply = false }); continue; }
            var g = matches[0]; var changes = new List<string>();
            var structural=g.TotalAmount!=Money(e.TotalAmount)||(e.Items??new()).Count!=g.Members.Count||(e.Items??new()).Any(i=>g.Members.Count(m=>Normalize(m.ParticipantName)==Normalize(i.Payer)&&m.AssignedAmount==Money(i.Amount))!=1);
            if(structural)changes.Add("Allocation structure or bill total changed — manual mapping required; no automatic overwrite");
            if(Normalize(g.Title)!=Normalize(string.IsNullOrWhiteSpace(e.Title)?e.GroupName?.Trim()+" Expense":e.Title))changes.Add("Source title changed");
            if (g.SourceState != e.State) changes.Add($"expense state {g.SourceState ?? g.Status} → {e.State}");
            foreach (var item in e.Items ?? new()) {
                var ms = g.Members.Where(m => Normalize(m.ParticipantName) == Normalize(item.Payer) && m.AssignedAmount == Money(item.Amount)).ToList();
                if (ms.Count != 1) { changes.Add($"participant {item.Payer}: ambiguous/missing"); continue; }
                var m = ms[0];
                if (m.IsUser != names.Contains(Normalize(item.Payer))) changes.Add($"owner identity: {item.Payer}");
                if (m.SourceState != item.State || (m.LinkedBankReference == null && m.PaidAmount != (IsPaid(item.State) ? m.AssignedAmount : 0))) changes.Add($"{item.Payer}: {item.State}");
            }
            if (changes.Count > 0) repairs.Add(new { RecordId = source.r.Id, SplitId = (int?)g.Id, Title = g.Title, Reason = string.Join("; ", changes), Before = Fingerprint(g), After = e.State, CanApply = !structural });
        }
        var duplicates = members.Where(m => m.LinkedBankReference != null).GroupBy(m => TxKey(m.LinkedAccountId ?? 0, m.LinkedBankReference!, m.LinkedBankType ?? "", m.LinkedTransactionType ?? "")).Where(g => g.Count() > 1).Select(g => new { Key = g.Key, Members = g.Select(m => new { m.Id, SplitId = m.Group.Id, m.ParticipantName, m.PaidAmount }) }).ToList();
        var accounts = (await session.Query<Account>().Where(a => a.OwnerUserId == userId).ToListAsync()).Select(a=>a.Id).ToList();
        var banks = await session.Query<BankTransaction>().Where(t=>accounts.Contains(t.AccountId)).ToListAsync();
        var linkWarnings = members.Where(m=>m.LinkedBankReference!=null).Select(m=> {
            var bank=banks.FirstOrDefault(t=>TxKey(t.AccountId,t.BankReference,t.BankType,t.TransactionType)==TxKey(m.LinkedAccountId??0,m.LinkedBankReference!,m.LinkedBankType??"",m.LinkedTransactionType??""));
            var own=IsCreator(m.Group,names);var self=IsSelf(m,names);
            var reason=bank==null?"Missing bank transaction":bank.TransferGroupId!=null||bank.Mode=="TRANSFER"?"Own-account transfer":own==self?"Not an owner repayment flow":(own?bank.Credit:bank.Debit)<=0?"Wrong payment direction":(bank.Credit>0?bank.Credit:bank.Debit)!=m.PaidAmount?"Amount differs from linked payment":null;
            return new { MemberId=m.Id,SplitId=m.Group.Id,m.ParticipantName,Reason=reason };
        }).Where(x=>x.Reason!=null).ToList();
        var settlements = members.Where(m => Imported(m.Group)).Select(m => new { SplitId = m.Group.Id, Title = m.Group.Title, m.Id, m.ParticipantName, m.SourceState, m.SettlementEvidence, m.AssignedAmount, m.PaidAmount, EligibleFlow = IsCreator(m.Group,names) != IsSelf(m,names), IsOwner = IsSelf(m, names), Direction = IsCreator(m.Group, names) ? "To collect" : "Owed by me", Active = m.Group.Status is not ("Closed" or "Cancelled"), AgeDays = Math.Max(0, (DateTime.UtcNow.AddMinutes(330).Date - m.Group.Date.Date).Days), HasBankLink = m.LinkedBankReference != null }).ToList();
        object[] Read(string kind) => records.Where(r => r.Kind == kind).OrderByDescending(r => r.Id).Select(r => (object)new { r.Id, r.CreatedUtc, Source = JsonSerializer.Deserialize<EvidencePayload>(r.Payload, Json) }).ToArray();
        return new {
            Batches = records.Where(r => r.Kind == "Batch").OrderByDescending(r => r.Id).Select(r => JsonSerializer.Deserialize<JsonElement>(r.Payload)),
            Repairs = repairs, DuplicateLinks = duplicates, LinkWarnings=linkWarnings, Settlements = settlements,
            Activities = Read("Activity"), Orders = Read("Order"), Rewards = Read("Cashback"), Vouchers = Read("Voucher"), Remittances = Read("Remittance"),
            Allocations = await session.Query<GPaySettlementAllocation>().Where(a => a.OwnerUserId == userId).ToListAsync(), OwnerNames = names.OrderBy(n => n),
            Decisions = records.Where(r => r.Kind is "Decision" or "RepairAudit" or "RepairUndoAudit" or "AllocationAudit" or "ReviewAudit").OrderByDescending(r => r.Id).Select(r => new { r.Id, r.Kind, r.CreatedUtc, Data = JsonSerializer.Deserialize<JsonElement>(r.Payload) })
        };
    }

    public static string Fingerprint(SplitGroup g) => Hash(JsonSerializer.Serialize(new { g.Id, g.Title, g.Status, g.TotalAmount, g.UserShareAmount, g.SettledAmount, g.SourceKey, g.SourceState, g.CreatorName, g.SourceSnapshot, Members = g.Members.OrderBy(m => m.Id).Select(m => new { m.Id, m.AssignedAmount, m.PaidAmount, m.IsUser, m.IsSettled, m.SourceState, m.SettlementEvidence, m.Notes, m.LinkedAccountId, m.LinkedBankReference, m.LinkedBankType, m.LinkedTransactionType }) }));

    public async Task ApplyRepair(long userId, int recordId, string expected)
    {
        using var session = DbHelper.GetSession(); using var transaction = session.BeginTransaction();
        var record = await session.Query<GPayEvidenceRecord>().FirstOrDefaultAsync(r => r.Id == recordId && r.OwnerUserId == userId && r.Kind == "Expense") ?? throw new ArgumentException("Source expense not found.");
        var p = JsonSerializer.Deserialize<EvidencePayload>(record.Payload, Json)!;
        var e = JsonSerializer.Deserialize<GPayExpenseItem>(p.Data, Json)!;
        var groups = await session.Query<SplitGroup>().Where(g => g.OwnerUserId == userId).ToListAsync();
        var matches = Corresponding(groups, e); if (matches.Count != 1) throw new ArgumentException("Source is ambiguous or missing. Import before repairing.");
        var g = matches[0]; await session.LockAsync(g, LockMode.Upgrade);
        await session.RefreshAsync(g); if (Fingerprint(g) != expected) throw new ArgumentException("Expense changed. Refresh the review before applying.");
        if(g.TotalAmount!=Money(e.TotalAmount)||(e.Items??new()).Count!=g.Members.Count)throw new ArgumentException("Bill total or participant structure changed; manual mapping required.");
        var names = await OwnerNames(session, userId);
        var before = JsonSerializer.Serialize(new { g.Id, g.Title, g.Status, g.SourceKey, g.SourceState, g.CreatorName, g.SourceSnapshot, g.SourceImportedUtc, g.UserShareAmount, g.SettledAmount, Members = g.Members.Select(m => new { m.Id, m.IsUser, m.PaidAmount, m.IsSettled, m.SourceState, m.SettlementEvidence, m.Notes }) });
        foreach (var item in e.Items ?? new()) {
            var ms = g.Members.Where(m => Normalize(m.ParticipantName) == Normalize(item.Payer) && m.AssignedAmount == Money(item.Amount)).ToList();
            if (ms.Count != 1) throw new ArgumentException("Participant identity is ambiguous; manual review required.");
            var m = ms[0]; m.IsUser = names.Contains(Normalize(item.Payer)); m.SourceState = item.State;
            if (m.LinkedBankReference == null && !await session.Query<GPaySettlementAllocation>().AnyAsync(a => a.OwnerUserId == userId && a.MemberId == m.Id)) { m.PaidAmount = IsPaid(item.State) ? m.AssignedAmount : 0; m.IsSettled = IsPaid(item.State); m.SettlementEvidence = Evidence(item.State); }
            if (string.IsNullOrWhiteSpace(m.Notes)) m.Notes = item.Note;
            await session.UpdateAsync(m);
        }
        g.SourceKey = p.IdentityKey; g.SourceState = e.State; g.CreatorName = e.Creator; g.SourceSnapshot = p.Data; g.SourceImportedUtc = record.CreatedUtc;
        g.Title=string.IsNullOrWhiteSpace(e.Title)?(e.GroupName?.Trim() ?? "General Split")+" Expense":e.Title.Trim();
        g.UserShareAmount = g.Members.Where(m => m.IsUser).Sum(m => m.AssignedAmount);
        Recalculate(g, names); await session.UpdateAsync(g);
        await session.SaveAsync(new GPayEvidenceRecord { OwnerUserId = userId, Kind = "RepairAudit", SourceKey = Hash(Guid.NewGuid().ToString()), Payload = JsonSerializer.Serialize(new { SplitId = g.Id, RecordId = recordId, Before = before, AfterFingerprint = Fingerprint(g), AppliedUtc = DateTime.UtcNow }) });
        await transaction.CommitAsync();
    }

    public static void Recalculate(SplitGroup g, HashSet<string> names) {
        var own = IsCreator(g, names);
        g.SettledAmount = own ? g.Members.Where(m => !IsSelf(m, names)).Sum(m => Math.Min(m.AssignedAmount, m.PaidAmount)) : g.Members.Where(m => IsSelf(m, names)).Sum(m => Math.Min(m.AssignedAmount, m.PaidAmount));
        g.Status = g.SourceState == "CLOSED" ? "Closed" : g.SourceState == "COMPLETED" ? "Settled" : g.Members.Count > 0 && g.Members.All(m => IsSelf(m, names) && own || m.IsSettled) ? "Settled" : "Active";
        g.UpdatedOn = DateTime.UtcNow.AddMinutes(330);
    }

    public async Task UndoRepair(long userId, int auditId)
    {
        using var session=DbHelper.GetSession();using var tx=session.BeginTransaction();
        var record=await session.Query<GPayEvidenceRecord>().FirstOrDefaultAsync(r=>r.OwnerUserId==userId&&r.Id==auditId&&r.Kind=="RepairAudit")??throw new ArgumentException("Repair audit not found.");
        var audit=JsonSerializer.Deserialize<JsonElement>(record.Payload);
        var id=audit.GetProperty("SplitId").GetInt32();
        var g=await session.Query<SplitGroup>().FirstOrDefaultAsync(g=>g.OwnerUserId==userId&&g.Id==id)??throw new ArgumentException("Expense no longer exists.");
        await session.LockAsync(g,LockMode.Upgrade);await session.RefreshAsync(g);
        if(Fingerprint(g)!=audit.GetProperty("AfterFingerprint").GetString())throw new ArgumentException("Expense changed since this repair. Review current data instead of undoing.");
        var before=JsonSerializer.Deserialize<JsonElement>(audit.GetProperty("Before").GetString()!);
        if(before.TryGetProperty("Title",out var title))g.Title=title.GetString()!;
        g.Status=before.GetProperty("Status").GetString()!;g.SourceKey=before.GetProperty("SourceKey").GetString();g.SourceState=before.GetProperty("SourceState").GetString();
        g.CreatorName=before.GetProperty("CreatorName").GetString();g.SourceSnapshot=before.GetProperty("SourceSnapshot").GetString();
        g.SourceImportedUtc=before.TryGetProperty("SourceImportedUtc",out var instant)&&instant.ValueKind!=JsonValueKind.Null?instant.GetDateTime():null;
        g.UserShareAmount=before.GetProperty("UserShareAmount").GetDecimal();g.SettledAmount=before.GetProperty("SettledAmount").GetDecimal();
        foreach(var old in before.GetProperty("Members").EnumerateArray()) {
            var m=g.Members.SingleOrDefault(m=>m.Id==old.GetProperty("Id").GetInt32())??throw new ArgumentException("Participant changed; undo aborted.");
            m.IsUser=old.GetProperty("IsUser").GetBoolean();m.PaidAmount=old.GetProperty("PaidAmount").GetDecimal();m.IsSettled=old.GetProperty("IsSettled").GetBoolean();
            m.SourceState=old.GetProperty("SourceState").GetString();m.SettlementEvidence=old.GetProperty("SettlementEvidence").GetString();m.Notes=old.GetProperty("Notes").GetString();await session.UpdateAsync(m);
        }
        g.UpdatedOn=DateTime.UtcNow.AddMinutes(330);await session.UpdateAsync(g);
        await session.SaveAsync(new GPayEvidenceRecord{OwnerUserId=userId,Kind="RepairUndoAudit",SourceKey=Hash(Guid.NewGuid().ToString()),Payload=JsonSerializer.Serialize(new{AuditId=auditId,SplitId=id,RestoredFingerprint=Fingerprint(g)})});
        await tx.CommitAsync();
    }

    public async Task AddOwnerAlias(long userId, string alias)
    {
        alias = Normalize(alias); if (alias.Length < 2 || alias.Length > 250) throw new ArgumentException("Enter an exact owner display name, 2–250 characters.");
        using var session = DbHelper.GetSession(); using var tx = session.BeginTransaction();
        var key = Hash(alias); if (!await session.Query<GPayEvidenceRecord>().AnyAsync(r => r.OwnerUserId == userId && r.Kind == "OwnerAlias" && r.SourceKey == key))
            await session.SaveAsync(new GPayEvidenceRecord { OwnerUserId = userId, Kind = "OwnerAlias", SourceKey = key, Payload = JsonSerializer.Serialize(alias) });
        await tx.CommitAsync();
    }
}
