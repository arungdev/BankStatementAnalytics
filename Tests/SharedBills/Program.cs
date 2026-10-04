using BankStatementAnalytics.Models;
using BankStatementAnalytics.Services;

var checks = 0;
void Check(bool condition, string name) { if (!condition) throw new Exception(name); checks++; Console.WriteLine($"PASS: {name}"); }
SplitGroupMemberDto Member(int id, long? account = null, string? reference = null, string type = "CR", bool self = false) => new() {
    Id = id, ParticipantName = "Participant", IsUser = self, LinkedAccountId = account,
    LinkedBankReference = reference, LinkedBankType = "IOB", LinkedTransactionType = type, SettlementEvidence = "Bank verified"
};
var groups = new List<SplitGroupDetailDto> {
    new() { Id = 1, Title = "My bill", TotalAmount = 1000, UserShareAmount = 200, SettledAmount = 600, PendingAmount = 200,
        VerifiedAmount = 400, Date = new(2026,9,30,23,59,0), IsCreatedByUser = true, ParentAccountId = 1,
        ParentBankReference = "BILL", ParentBankType = "IOB", ParentTransactionType = "DR", Members = [Member(11, 1, "PAY")] },
    new() { Id = 2, Title = "Friend's bill", TotalAmount = 500, UserShareAmount = 100, PendingAmount = 100,
        Date = new(2026,10,1), Members = [Member(21, 2, "PAY", "DR", true)] },
    new() { Id = 3, Title = "Unlinked import", TotalAmount = 200, UserShareAmount = 50, SettledAmount = 100,
        PendingAmount = 50, Date = new(2026,9,1), IsCreatedByUser = true, Members = [Member(31)] },
    new() { Id = 4, Title = "Closed", TotalAmount = 100, UserShareAmount = 10, PendingAmount = 0, Date = new(2026,9,1), Status = "Closed" }
};
var allocations = new List<GPaySettlementAllocation> { new() { SplitId = 3, MemberId = 31, AccountId = 3, BankReference = "ALLOC", BankType = "HDFC", TransactionType = "CR", Amount = 40 } };
var all = SharedBillInsights.Summarize(groups, allocations);
Check(all.BillCount == 4 && all.TotalBillVolume == 1800 && all.MyShare == 360, "all profiles include imported bills without bank links");
Check(all.ToCollect == 250 && all.OwedByMe == 100, "collection and personal debts remain separate");
Check(all.RecordedSettlements == 700 && all.BankVerified == 400, "existing recorded and verified balances remain separate");
Check(all.OutstandingBills.Select(g => g.Id).SequenceEqual(new[] { 1, 2, 3 }), "pending rows sort by amount and omit closed zero-balance bills");
var september = SharedBillInsights.Summarize(groups, allocations, startDate: new(2026,9,1), endDate: new(2026,9,30));
Check(september.BillCount == 3 && september.ToCollect == 250 && september.OwedByMe == 0, "inclusive bill-date period includes final day and excludes next month");
Check(SharedBillInsights.Summarize(groups, allocations, new() { 1 }).BillCount == 1, "account-scoped summary includes bill parent and direct repayment once");
Check(SharedBillInsights.Summarize(groups, allocations, new() { 2 }).OwedByMe == 100, "account-scoped personal repayment retains existing pending balance");
Check(SharedBillInsights.Summarize(groups, allocations, new() { 3 }).BillCount == 1, "allocation-only bank link scopes its bill");
Check(SharedBillInsights.Summarize(groups, allocations, new() { 99 }).BillCount == 0, "unrelated accounts never inherit source-only bills");
var invalid = new List<GPaySettlementAllocation> { new() { SplitId = 1, MemberId = 31, AccountId = 99, Amount = 20 }, new() { SplitId = 3, MemberId = 31, AccountId = 99, Amount = -20 } };
Check(SharedBillInsights.Summarize(groups, invalid, new() { 99 }).BillCount == 0, "orphaned and non-positive allocations do not create a relationship");
List<SharedBillTransactionContext> Context(long account, string reference, string bank = "IOB", string type = "CR") => SharedBillInsights.ForTransaction(groups, allocations, account, reference, bank, type);
Check(Context(1,"BILL",type:"DR").Single().Role == "Bill payment", "parent bank link opens the original bill");
Check(Context(1,"PAY").Single().Role == "Participant repayment", "incoming member link is labelled participant repayment");
Check(Context(2,"PAY",type:"DR").Single().Role == "My repayment", "outgoing self link is labelled my repayment");
Check(Context(1,"PAY",type:"DR").Count == 0 && Context(2,"PAY").Count == 0, "direction and account are part of transaction identity");
Check(Context(1,"PAY",bank:"HDFC").Count == 0 && Context(1,"UNKNOWN").Count == 0, "bank and reference are part of transaction identity");
Check(Context(1,"PAY",type:"").Count == 0, "incomplete keys never infer a link");
Check(Context(3,"ALLOC","HDFC").Single().AllocatedAmount == 40, "only explicit allocation amount is presented as allocated from transaction");
Check(Context(1,"PAY").Single().AllocatedAmount == null, "direct member paid amount is never mistaken for transaction allocation");
groups[2].Members[0].LinkedAccountId = 3; groups[2].Members[0].LinkedBankReference = "ALLOC"; groups[2].Members[0].LinkedBankType = "HDFC";
Check(Context(3,"ALLOC","HDFC").Count == 1, "direct link and allocation for same member do not duplicate context");
Check(groups[0].PendingAmount == 200 && groups[0].SettledAmount == 600, "insights do not mutate financial values");
Console.WriteLine($"{checks} shared-bill checks passed.");
