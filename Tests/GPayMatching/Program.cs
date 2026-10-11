using System.Text.Json;
using BankStatementAnalytics.Models;
using BankStatementAnalytics.Services;
using NHibernate.Linq;

var checks = 0;
void Check(bool condition, string name) { if (!condition) throw new Exception(name); checks++; Console.WriteLine($"PASS: {name}"); }
var day = new DateTime(2026, 10, 2, 18, 45, 0);
var accounts = new List<Account> { new() { Id = 1, AccountNumber = "12347720" }, new() { Id = 2, AccountNumber = "56789999" } };
GPayEvidenceRecord Source(int id = 1, string? suffix = null, string? payee = null, string state = "Completed", string type = "Received", string? profile = null, string? identity = null) => new() {
    Id = id, Kind = "Activity", Payload = JsonSerializer.Serialize(new EvidencePayload(identity ?? $"identity-{id}", JsonSerializer.Serialize(new GPayUpiActivityItem { RefId = $"source-{id}", Timestamp = day, Amount = 300, Type = type, AccountSuffix = suffix, CounterPartyName = payee, Status = state }), "test-archive", profile))
};
BankTransaction Bank(string reference = "BANK-A", long account = 1, decimal amount = 300, bool credit = true, DateTime? date = null, string description = "UPI/Arun Kumar") => new() { AccountId = account, BankReference = reference, BankType = "IOB", TransactionType = credit ? "CR" : "DR", Credit = credit ? amount : 0, Debit = credit ? 0 : amount, TransactionDate = date ?? day.Date, Description = description, Mode = "UPI" };
GPayEvidenceRecord Profile(string id, params long[] bankIds) => new() { Kind = "Profile", Payload = JsonSerializer.Serialize(new GPayAutoImportConfigDto { ProfileId = id, UserName = "Owner", BankAccountIds = bankIds.ToList() }) };
GPayEvidenceRecord Decision(int recordId, bool accept, string reference = "BANK-A") => new() { Kind = "Decision", Payload = JsonSerializer.Serialize(new ReviewSourceRequest { RecordId = recordId, Accept = accept, AccountId = 1, BankReference = reference, BankType = "IOB", TransactionType = "CR" }) };
Dictionary<int, GPayEvidenceService.ActivityBankMatch> Plan(List<GPayEvidenceRecord>? records = null, List<BankTransaction>? banks = null, List<Account>? owned = null) => GPayEvidenceService.PlanAutomaticActivityMatches(records ?? [Source()], owned ?? accounts, banks ?? [Bank()]);
Check(Plan()[1].Status == "Ready", "unique same-day amount and direction can link");
Check(Plan(banks: [Bank(date: day.AddDays(-1))])[1].Bank == null, "adjacent dates never link automatically");
GPayEvidenceRecord AtTime(DateTime time, int id = 1, string? suffix = null, string? payee = null, string type = "Received", string state = "Completed", string? profile = null) {
    var source = Source(id, suffix, payee, state, type, profile);
    var payload = JsonSerializer.Deserialize<EvidencePayload>(source.Payload)!;
    var activity = JsonSerializer.Deserialize<GPayUpiActivityItem>(payload.Data)!; activity.Timestamp = time;
    source.Payload = JsonSerializer.Serialize(payload with { Data = JsonSerializer.Serialize(activity) });
    return source;
}
BankTransaction ValueBank(int offset = -1, string reference = "BANK-A", long account = 1, bool credit = true) {
    var bank = Bank(reference, account, credit: credit, date: day.Date.AddDays(offset)); bank.ValueDate = day.Date;
    return bank;
}
Check(Plan([AtTime(day.Date.AddMinutes(44))], [ValueBank()])[1].Status == "Ready", "midnight receipt matches its explicitly stored next-day bank value date");
Check(Plan([AtTime(day.Date.AddMinutes(44))], [ValueBank()])[1].Reason.Contains("value date"), "value-date evidence explains the differing displayed transaction date");
Check(Plan(banks: [ValueBank(offset: 1)])[1].Status == "Ready", "an explicitly stored previous-day value date also matches");
Check(Plan(banks: [ValueBank()])[1].Status == "Ready", "explicit value-date matching is supported for daytime payments");
Check(Plan(banks: [ValueBank(offset: -2)])[1].Bank == null, "value dates two days away from transaction date cannot match automatically");
var wrongValue = ValueBank(); wrongValue.ValueDate = day.AddDays(1);
Check(Plan(banks: [wrongValue])[1].Bank == null, "adjacent transaction date without an agreeing value date remains unlinked");
var nonUpiValue = ValueBank(); nonUpiValue.Mode = "NEFT";
Check(Plan(banks: [nonUpiValue])[1].Bank == null, "value-date exception is limited to UPI payments");
Check(Plan([Source(type: "Sent")], [ValueBank(credit: false)])[1].Status == "Ready", "outgoing payment can match the bank value date and debit direction");
Check(Plan(banks: [ValueBank(credit: false)])[1].Bank == null, "value-date matching still enforces direction");
var wrongValueAmount = ValueBank(); wrongValueAmount.Credit = 301;
Check(Plan(banks: [wrongValueAmount])[1].Bank == null, "value-date matching still enforces exact amount");
Check(Plan([Source(suffix: "9999")], [ValueBank()])[1].Bank == null, "value-date matching still enforces account hints");
Check(Plan([Source(profile: "second"), Profile("second", 2)], [ValueBank()])[1].Bank == null, "value-date matching respects profile account restrictions");
Check(Plan(banks: [Bank("SAME-DAY"), ValueBank(reference: "VALUE-DATE")])[1].Status == "Ambiguous", "same-day and value-date candidates compete without an arbitrary preference");
var crossDateCompetition = Plan([AtTime(day.Date.AddMinutes(44), 1), AtTime(day.Date.AddDays(-1).AddHours(23), 2)], [ValueBank()]);
Check(crossDateCompetition.Values.All(match => match.Status == "Ambiguous"), "one bank payment cannot serve sources on its two different dates");
Check(Plan([Source(), Decision(1, false)], [ValueBank()])[1].Status == "Unlinked", "value-date matching cannot override a rejected decision");
var valueTransfer = ValueBank(); valueTransfer.TransferGroupId = Guid.NewGuid();
Check(Plan(banks: [valueTransfer])[1].Bank == null, "own-account transfers remain excluded from value-date matching");
Check(Plan([Source(state: "Failed")], [ValueBank()])[1].Status == "Not eligible", "failed payments remain excluded from value-date matching");
Check(Plan([Source(payee: "Different Person")], [ValueBank()])[1].Bank == null, "value-date matching cannot override a conflicting named payee");
var wrongValueSource = ValueBank(); wrongValueSource.Note = "GPay: Received (Ref: another-source)";
Check(Plan(banks: [wrongValueSource])[1].Bank == null, "value-date matching cannot override a conflicting source identifier");
var valueDecision = Decision(1, true); var valueRequest = JsonSerializer.Deserialize<ReviewSourceRequest>(valueDecision.Payload)!;
valueRequest.MatchMethod = "AutomaticValueDate"; valueDecision.Payload = JsonSerializer.Serialize(valueRequest);
Check(Plan([Source(), valueDecision], [ValueBank()])[1].Status == "Linked" && Plan([Source(), valueDecision], [ValueBank()])[1].Reason.Contains("value date"), "saved value-date matches remain linked with accurate evidence");
Check(Plan(banks: [Bank(amount: 301)])[1].Bank == null, "different amounts never link");
Check(Plan(banks: [Bank(credit: false)])[1].Bank == null, "opposite payment direction never links");
Check(Plan([Source(type: "Sent")], [Bank(credit: false)])[1].Status == "Ready", "outgoing payment links to a debit");
foreach (var state in new[] { "Failed", "Cancelled", "Pending", "Unknown" }) Check(Plan([Source(state: state)])[1].Status == "Not eligible", $"{state} payment is excluded");
Check(Plan([Source(suffix: "9999")])[1].Bank == null, "source bank suffix is enforced");
Check(Plan([Source(suffix: "7720")])[1].Status == "Ready", "matching account suffix is accepted");
Check(Plan([Source(payee: "Arun Kumar")])[1].Status == "Ready", "available payee agrees with bank details");
Check(Plan([Source(payee: "Different Person")])[1].Bank == null, "conflicting payee blocks automatic linking");
Check(Plan([Source(payee: "Arun")], [Bank(description: "UPI/Varun")])[1].Bank == null, "payee matches whole tokens, not substrings");
BankTransaction IobPayee(string name, string reference = "BANK-A") => Bank(reference, description: $"UPI/130307216789/CR/{name}/UTI/UPI");
Check(Plan([Source(suffix: "7720", payee: "VENKAtesh Vasudevan")], [IobPayee("VENKATESH VASU")])[1].Status == "Ready", "actual Venkatesh IOB name truncation matches with exact account and payment facts");
Check(Plan([Source(suffix: "7720", payee: "SANKARA GOMATHI AAVI")], [IobPayee("SANKARA GOMATH")])[1].Status == "Ready", "truncated statement may omit later name words");
Check(Plan([Source(suffix: "7720", payee: "IRCTC E-TICKETING")], [IobPayee("IRCTC ETICKETI")])[1].Status == "Ready", "punctuation does not prevent the long statement prefix matching");
Check(Plan([Source(suffix: "7720", payee: "SUNDARAMAHALINGAM LINGARATHINAVEL")], [IobPayee("SUNDARAMAHA LIN")])[1].Status == "Ready", "PDF spacing inside the truncated payee is tolerated");
Check(Plan([Source(payee: "VENKAtesh Vasudevan")], [IobPayee("VENKATESH VASU")])[1].Bank == null, "truncation fallback requires an identifying source account hint");
Check(Plan([Source(suffix: "7720", payee: "Venkatesh Kumar")], [IobPayee("VENKATESH VASU")])[1].Bank == null, "matching first name alone never overrides conflicting surname");
Check(Plan([Source(suffix: "7720", payee: "Arun Kumar")], [IobPayee("ARUN")])[1].Bank == null, "short prefixes are insufficient for automatic matching");
Check(Plan([Source(suffix: "7720", payee: "IRCTC Web UPI")], [IobPayee("WEB UPI")])[1].Bank == null, "merchant name substitutions are not invented");
var differentBank = IobPayee("VENKATESH VASU"); differentBank.BankType = "HDFC";
Check(Plan([Source(suffix: "7720", payee: "Venkatesh Vasudevan")], [differentBank])[1].Bank == null, "IOB truncation rule does not apply to other banks");
Check(Plan([Source(suffix: "7720", payee: "Venkatesh Vasudevan")], [IobPayee("VENKATESH VASU"), IobPayee("VENKATESH VASU", "BANK-B")])[1].Status == "Ambiguous", "multiple abbreviated bank names remain ambiguous");
var samePrefix = Plan([Source(1, "7720", "Venkatesh Vasudevan"), Source(2, "7720", "Venkatesh Vasuki")], [IobPayee("VENKATESH VASU")]);
Check(samePrefix.Values.All(match => match.Status == "Ambiguous"), "competing full names sharing a bank prefix both remain unlinked");
var wrongAnnotation = IobPayee("VENKATESH VASU"); wrongAnnotation.Note = "GPay Paid: source; source another-activity; timestamp";
Check(Plan([Source(suffix: "7720", payee: "Venkatesh Vasudevan")], [wrongAnnotation])[1].Bank == null, "truncation never overrides an existing different source identifier");
Check(Plan([Source(payee: "Different Person")])[1].Reason.Contains("payee names"), "unmatched reason distinguishes conflicting names from absent bank data");
var aliasWitness = Source(10, "7720", "IRCTC Web UPI", type: "Paid");
BankTransaction WebBank(string reference = "BANK-A", long account = 1, string payee = "WEB UPI", bool credit = false) => Bank(reference, account, credit: credit, description: $"UPI/130195315384/{(credit ? "CR" : "DR")}/ {payee}/YES/UPI");
GPayEvidenceRecord AliasConfirmation(string method = "Manual", bool accept = true) => new() { Kind = "Decision", Payload = JsonSerializer.Serialize(new ReviewSourceRequest { RecordId = 10, Accept = accept, AccountId = 1, BankReference = "CONFIRMED", BankType = "IOB", TransactionType = "DR", MatchMethod = method }) };
Dictionary<int, GPayEvidenceService.ActivityBankMatch> AliasPlan(GPayEvidenceRecord? next = null, GPayEvidenceRecord? confirmation = null, BankTransaction? nextBank = null, GPayEvidenceRecord? witness = null, List<GPayEvidenceRecord>? extra = null) => Plan([witness ?? aliasWitness, next ?? Source(1, "7720", "IRCTC Web UPI", type: "Paid"), confirmation ?? AliasConfirmation(), ..extra ?? []], [WebBank("CONFIRMED"), nextBank ?? WebBank()]);
Check(AliasPlan()[1].Status == "Ready", "explicitly confirmed IRCTC Web UPI to WEB UPI alias matches later payments");
Check(AliasPlan()[1].Reason.Contains("previously confirmed"), "alias match records its confirmation evidence");
Check(AliasPlan(Source(1, "7720", "IRCTC_WEB_UPI", type: "Paid"))[1].Status == "Ready", "confirmed alias normalizes punctuation and spacing only");
Check(AliasPlan(confirmation: AliasConfirmation("AutomaticSameDay"))[1].Bank == null, "automatic inferences never teach payee aliases");
Check(AliasPlan(confirmation: AliasConfirmation(accept: false))[1].Bank == null, "rejected matches never teach aliases");
Check(AliasPlan(Source(1, "7720", "IRCTC App UPI", type: "Paid"))[1].Bank == null, "web alias does not imply a different app alias");
Check(AliasPlan(Source(1, "7720", "Other Web UPI", type: "Paid"))[1].Bank == null, "unrelated merchants cannot use a confirmed alias");
Check(AliasPlan(nextBank: WebBank(payee: "OTHER WEB UPI"))[1].Bank == null, "confirmed bank payee must agree exactly");
Check(AliasPlan(Source(1, "9999", "IRCTC Web UPI", type: "Paid"), nextBank: WebBank(account: 2))[1].Bank == null, "confirmed aliases do not cross bank accounts");
Check(AliasPlan(Source(1, "7720", "IRCTC Web UPI", type: "Paid", profile: "other"), extra: [Profile("other", 1)])[1].Bank == null, "confirmed aliases do not cross GPay profiles");
Check(AliasPlan(Source(1, "7720", "IRCTC Web UPI", type: "Received"), nextBank: WebBank(credit: true))[1].Bank == null, "confirmed aliases do not cross payment directions");
var aliasOtherBank = WebBank(); aliasOtherBank.BankType = "HDFC";
Check(AliasPlan(nextBank: aliasOtherBank)[1].Bank == null, "confirmed aliases do not cross bank types");
var aliasOtherMode = WebBank(); aliasOtherMode.Mode = "NEFT";
Check(AliasPlan(nextBank: aliasOtherMode)[1].Bank == null, "confirmed aliases do not cross payment modes");
var aliasOtherRouting = WebBank(); aliasOtherRouting.Description = aliasOtherRouting.Description.Replace("/YES/", "/HDF/");
Check(AliasPlan(nextBank: aliasOtherRouting)[1].Bank == null, "confirmed aliases do not cross payee bank routing codes");
Check(AliasPlan(witness: Source(10, payee: "IRCTC Web UPI", type: "Paid"))[1].Bank == null, "confirmation without an identifying account hint cannot teach an alias");
var datedWitness = Source(10, "7720", "IRCTC Web UPI", type: "Paid");
var datedPayload = JsonSerializer.Deserialize<EvidencePayload>(datedWitness.Payload)!;
var datedActivity = JsonSerializer.Deserialize<GPayUpiActivityItem>(datedPayload.Data)!; datedActivity.Timestamp = day.AddDays(-1);
datedWitness.Payload = JsonSerializer.Serialize(datedPayload with { Data = JsonSerializer.Serialize(datedActivity) });
Check(AliasPlan(witness: datedWitness)[1].Bank == null, "off-date manual confirmation does not teach automatic aliases");
var aliasReservedNote = WebBank(); aliasReservedNote.Note = "GPay Paid: other; source another-id; timestamp";
Check(AliasPlan(nextBank: aliasReservedNote)[1].Bank == null, "alias cannot override a conflicting source identifier");
var aliasCompetition = AliasPlan(extra: [Source(2, "7720", "IRCTC Web UPI", type: "Paid")]);
Check(aliasCompetition[1].Status == "Ambiguous" && aliasCompetition[2].Status == "Ambiguous", "competing activities remain ambiguous even with confirmed alias");
Check(Plan([aliasWitness, Source(1, "7720", "IRCTC Web UPI", type: "Paid"), AliasConfirmation()], [WebBank("CONFIRMED"), WebBank(), WebBank("BANK-B")])[1].Status == "Ambiguous", "repeated same-amount bank payments remain ambiguous with alias");
var susilaWitness = Source(10, "7720", "SUSILA AMMA BAJJI KADAI", type: "Paid");
var susilaConfirmed = WebBank("CONFIRMED", payee: "SUSILA A S"); susilaConfirmed.Description = susilaConfirmed.Description.Replace("/YES/", "/UTI/");
var susilaNext = WebBank(payee: "SUSILA A S"); susilaNext.Description = susilaNext.Description.Replace("/YES/", "/UTI/");
Check(Plan([susilaWitness, Source(1, "7720", "SUSILA AMMA BAJJI KADAI", type: "Paid"), AliasConfirmation()], [susilaConfirmed, susilaNext])[1].Status == "Ready", "confirmed shop name matches SUSILA A S bank identity with the same routing code");
Check(Plan([susilaWitness, Source(1, "7720", "SUSILA OTHER SHOP", type: "Paid"), AliasConfirmation()], [susilaConfirmed, susilaNext])[1].Bank == null, "confirmed shop alias never matches another merchant sharing the first name");
Check(Plan(banks: [Bank(), Bank("BANK-B")])[1].Status == "Ambiguous", "multiple same-day bank candidates are ambiguous");
var competing = Plan([Source(1), Source(2)]);
Check(competing.Values.All(match => match.Status == "Ambiguous"), "one bank payment cannot serve competing activities");
Check(competing[1].Candidates?.Count == 1 && competing[1].CompetingActivityCount == 1, "one bank candidate explains the other competing GPay payment");
Check(competing[1].Candidates![0].CompetingActivities == 1 && competing[1].Bank == null, "possible bank candidate is not exposed as a confirmed link");
var fourReceipts = Enumerable.Range(1, 4).Select(id => Source(id)).ToList();
var fourBanks = Enumerable.Range(1, 4).Select(id => Bank($"BANK-{id}")).ToList();
var repeatedReceipts = Plan(fourReceipts, fourBanks);
Check(repeatedReceipts.Values.All(match => match.Status == "Ambiguous" && match.Bank == null && match.Candidates?.Count == 4 && match.CompetingActivityCount == 3), "four unnamed receipts against four identical-amount bank payments remain unresolved with accurate counts");
Check(repeatedReceipts[1].Candidates!.All(candidate => candidate.CompetingActivities == 3 && candidate.Amount == 300 && candidate.TransactionDate == day.Date), "each possible match contains factual amount, date and competition count");
Check(repeatedReceipts[1].Candidates!.Select(candidate => candidate.Bank.BankReference).SequenceEqual(new[] { "BANK-1", "BANK-2", "BANK-3", "BANK-4" }), "candidate order is stable without implying payment-time order");
Check(Plan([Source(suffix: "7720")], [Bank(), Bank("OTHER", account: 2)])[1].Candidates == null, "excluded account is never advertised as a possible match");
var valueDateOptions = Plan(banks: [Bank("SAME-DAY"), ValueBank(reference: "VALUE-DATE")])[1];
Check(valueDateOptions.Candidates?.Single(candidate => candidate.Bank.BankReference == "VALUE-DATE").ValueDate == day.Date, "ambiguous candidate retains actual value-date evidence");
var unseenBank = Bank("UNOWNED", account: 99);
Check(Plan(fourReceipts, [..fourBanks, unseenBank])[1].Candidates!.All(candidate => candidate.Bank.AccountId != 99), "possible matches never disclose another owner's bank account");
Check(Plan([Source(payee: "Arun Kumar")], [Bank(), Bank("MISMATCH", description: "Other Person"), Bank("BANK-B")])[1].Candidates?.Count == 2, "conflicting named payees are excluded from possible matches");
Check(Plan([Source(), Source(2), Decision(2, true)], [Bank(), Bank("BANK-B"), Bank("BANK-C")])[1].Candidates!.All(candidate => candidate.Bank.BankReference != "BANK-A"), "previously confirmed bank payments are excluded from possible matches");
Check(Plan([Source(), Decision(1, false)])[1].Status == "Unlinked", "previous rejection is respected");
var confirmed = Plan([Source(), Source(2), Decision(1, true)]);
Check(confirmed[1].Status == "Linked" && confirmed[2].Bank == null, "confirmed links are retained and reserve their bank payment");
Check(Plan([Source(), Decision(1, true)], [Bank(amount: 301)])[1].Status == "Unavailable", "changed bank amount invalidates displayed link");
var transfer = Bank(); transfer.TransferGroupId = Guid.NewGuid();
Check(Plan(banks: [transfer])[1].Bank == null, "own-account transfers are excluded");
Check(Plan(banks: [Bank(account: 99)])[1].Bank == null, "unowned bank accounts are excluded");
var duplicateAccounts = new List<Account> { new() { Id = 1, AccountNumber = "12347720" }, new() { Id = 2, AccountNumber = "56787720" } };
Check(Plan([Source(suffix: "7720")], owned: duplicateAccounts)[1].Status == "Unlinked", "duplicate account suffixes remain unresolved");
var scoped = Plan([Source(profile: "second", suffix: "7720"), Profile("second", 1)], owned: duplicateAccounts);
Check(scoped[1].Status == "Ready", "explicit profile bank accounts disambiguate account suffixes");
Check(Plan([Source(profile: "second"), Profile("second", 2)])[1].Bank == null, "profile matching never crosses configured bank accounts");
Check(Plan([Source(profile: "missing")])[1].Status == "Unlinked", "missing profile never falls back to another profile");
var separate = Plan([Source(1, profile: "one", identity: "same"), Source(2, profile: "two", identity: "same"), Profile("one", 1), Profile("two", 2)], [Bank(), Bank("BANK-B", account: 2)]);
Check(separate.Values.All(match => match.Status == "Ready"), "different profiles can keep identical source identities in separate bank accounts");
var versions = Plan([Source(1, identity: "same"), Source(2, identity: "same"), Source(3)]);
Check(versions.Values.All(match => match.Status == "Ambiguous"), "conflicting source versions also block competing automatic assignments");
Check(versions[1].Candidates?.Count == 1 && versions[1].Reason.Contains("source versions"), "duplicate-source ambiguity keeps its distinct explanation and possible bank details");
var existing = Bank(); existing.Note = "Personal note | GPay: Received ₹300 (Ref: source-1)";
var annotated = Plan([Source(1), Source(2)], [existing]);
Check(annotated[1].Status == "Ready" && annotated[2].Bank == null, "existing source annotation identifies its own activity only");
var expense = new GPayExpenseItem { Creator = "Owner", CreationTime = "2026-10-02T00:00:00Z", TotalAmount = "₹300", Items = [] };
Check(GPayEvidenceService.ProfileExpenseKey(expense, "one") != GPayEvidenceService.ProfileExpenseKey(expense, "two"), "expense identities are namespaced by profile");
var split = new SplitGroup { GPayProfileId = "second", GPayOwnerName = "Second Owner", SourceKey = "import", CreatorName = "First Owner" };
var member = new SplitGroupMember { Group = split, ParticipantName = "First Owner" };
var names = new HashSet<string> { "first owner" };
Check(!GPayEvidenceService.IsCreator(split, names) && !GPayEvidenceService.IsSelf(member, names), "another profile's owner aliases do not redefine personal shares");
member.ParticipantName = "Second Owner"; split.CreatorName = "Second Owner";
Check(GPayEvidenceService.IsCreator(split, names) && GPayEvidenceService.IsSelf(member, names), "profile's own exact identity determines creator and personal share");
var pageRows = Enumerable.Range(1, 45).Select(id => new GPayEvidenceService.ActivityPageRow(
    id, day, new EvidencePayload($"page-{id}", JsonSerializer.Serialize(new {
        CounterPartyName = id == 3 ? "Needle merchant" : $"Merchant {id}", Amount = id,
        Timestamp = day.AddDays(id).ToString("O"), Details = id == 4 ? "quoted \"reference\"" : ""
    }), "archive", id % 2 == 0 ? "second" : null), "Test profile", null)).ToList();
GPayEvidenceService.ActivityPageResult Page(int index = 0, int size = 20, string profile = "all", string query = "", string field = "date", string direction = "desc") =>
    GPayEvidenceService.PageActivities(pageRows, index, size, profile, query, field, direction);
Check(Page().Records.Count == 20 && Page().TotalCount == 45 && Page().Records[0].Id == 45, "first page is bounded and sorted across the entire section");
Check(Page(1).Records.First().Id == 25 && !Page().Records.Select(r => r.Id).Intersect(Page(1).Records.Select(r => r.Id)).Any(), "next page has no overlap with the first page");
Check(Page(2).Records.Count == 5 && Page(99).Page == 2, "last page and out-of-range requests are clamped");
Check(Page(profile: "second").TotalCount == 22 && Page(profile: "second").Records.All(r => r.Source.ProfileId == "second"), "profile filtering happens before pagination");
Check(Page(profile: "default").TotalCount == 23, "legacy primary profile is included by the default filter");
Check(Page(query: "NEEDLE").Records.Single().Id == 3, "case-insensitive search finds records outside the original first page");
Check(Page(query: "quoted \"reference\"").Records.Single().Id == 4, "search includes decoded source data with quoted references");
Check(Page(query: "absent").TotalCount == 0 && Page(query: "absent").Records.Count == 0, "empty search results return no records");
Check(Page(field: "amount", direction: "asc").Records.First().Id == 1, "amount sorting is numeric across all records");
Check(Page(field: "name", direction: "asc").Records.First().Id == 1 && Page(field: "name", direction: "asc").Records.Last().Id == 27, "description sort is applied before taking the page");
var configuration = new NHibernate.Cfg.Configuration();
var postgresConnection = Environment.GetEnvironmentVariable("GPAY_TEST_POSTGRES");
configuration.DataBaseIntegration(db => {
    if (postgresConnection != null) {
        db.Dialect<NHibernate.Dialect.PostgreSQL83Dialect>();
        db.Driver<NHibernate.Driver.NpgsqlDriver>();
        db.ConnectionString = postgresConnection;
    } else {
        db.Dialect<NHibernate.Dialect.SQLiteDialect>();
        db.Driver<NHibernate.Driver.SQLite20Driver>();
        db.ConnectionString = "Data Source=:memory:;Version=3;New=True;";
    }
    db.ConnectionReleaseMode = NHibernate.ConnectionReleaseMode.OnClose;
});
var mapper = new NHibernate.Mapping.ByCode.ModelMapper();
mapper.AddMapping<BankStatementAnalytics.Mappping.GPayEvidenceRecordMap>();
mapper.AddMapping<BankStatementAnalytics.Mappping.BankTransactionMap>();
mapper.AddMapping<BankStatementAnalytics.Mappping.TransactionSplitMap>();
mapper.AddMapping<BankStatementAnalytics.Mapping.MerchantMap>();
mapper.AddMapping<BankStatementAnalytics.Mapping.MerchantUpiMap>();
configuration.AddMapping(mapper.CompileMappingForAllExplicitlyAddedEntities());
using var factory = configuration.BuildSessionFactory();
using var pagingSession = factory.OpenSession();
new NHibernate.Tool.hbm2ddl.SchemaExport(configuration).Execute(false, true, false, pagingSession.Connection, null);
foreach (var row in pageRows) await pagingSession.SaveAsync(new GPayEvidenceRecord {
    OwnerUserId = 123, Kind = "Activity", SourceKey = row.Source.IdentityKey,
    Payload = JsonSerializer.Serialize(row.Source), CreatedUtc = row.CreatedUtc
});
await pagingSession.SaveAsync(new GPayEvidenceRecord { OwnerUserId = 456, Kind = "Activity", SourceKey = "other-owner", Payload = JsonSerializer.Serialize(pageRows[0].Source) });
await pagingSession.SaveAsync(new GPayEvidenceRecord { OwnerUserId = 123, Kind = "Voucher", SourceKey = "other-section", Payload = JsonSerializer.Serialize(pageRows[0].Source) });
await pagingSession.FlushAsync();
pagingSession.Clear();
async Task<(IList<GPayEvidenceRecord> Records, int TotalCount, int Page)> DbPage(int index = 0, string profile = "all", string query = "", string field = "date", string direction = "desc") =>
    await GPayEvidenceService.ReadActivityPageAsync(pagingSession, 123, "Activity", index, 20, profile, query, field, direction);
var dbFirst = await DbPage();
Check(dbFirst.TotalCount == 45 && dbFirst.Records.Count == 20 && dbFirst.Records[0].SourceKey == "page-45", "database paging bounds payloads and excludes other tenants and sections");
var dbNext = await DbPage(1);
Check(dbNext.Records[0].SourceKey == "page-25" && !dbFirst.Records.Select(r => r.Id).Intersect(dbNext.Records.Select(r => r.Id)).Any(), "database pages have stable ordering without repeated records");
var dbProfile = await DbPage(profile: "second");
Check(dbProfile.TotalCount == 22 && dbProfile.Records.All(r => JsonSerializer.Deserialize<EvidencePayload>(r.Payload)!.ProfileId == "second"), "database profile filtering precedes paging");
Check((await DbPage(query: "NEEDLE")).Records.Single().SourceKey == "page-3", "database search finds off-page source names");
Check((await DbPage(query: "quoted \"reference\"")).Records.Single().SourceKey == "page-4", "database search handles decoded quoted source fields");
Check((await DbPage(query: "%")).TotalCount == 0 && (await DbPage(query: "_")).TotalCount == 0, "database search treats SQL wildcards as literal input");
Check((await DbPage(field: "amount", direction: "asc")).Records.First().SourceKey == "page-1", "database amount sorting is numeric");
Check((await DbPage(99)).Page == 2 && (await DbPage(99)).Records.Count == 5, "database final page clamps oversized page requests");
for (var index = 1; index <= 45; index++) {
    var bank = Bank(reference: $"insight-{index}", amount: 100, credit: false, date: day.AddDays(index));
    bank.CategoryOverride = "Food"; bank.Tags = index % 2 == 0 ? "other, food" : "seafood";
    await pagingSession.SaveAsync(bank);
    await pagingSession.SaveAsync(new TransactionSplit { OwnerUserId = 123, ParentAccountId = 1, ParentBankReference = bank.BankReference, ParentBankType = "IOB", Amount = 25, Category = "Travel" });
}
await pagingSession.FlushAsync(); pagingSession.Clear();
var insightQuery = pagingSession.Query<BankTransaction>().Where(t => t.AccountId == 1 && t.Debit > 0);
async Task<JsonElement> InsightPage(string grouping, string value, int index = 1) =>
    JsonSerializer.SerializeToElement(await InsightTransactionPaging.ReadAsync(pagingSession, insightQuery, grouping, value, index, 20));
var foodPage = await InsightPage("byCategory", "Food");
Check(foodPage.GetProperty("totalCount").GetInt32() == 45 && foodPage.GetProperty("items").GetArrayLength() == 20 && foodPage.GetProperty("totalAmount").GetDecimal() == 3375, "category paging uses database bounds and preserves the total unallocated spend");
var travelPage = await InsightPage("byCategory", "Travel", 2);
Check(travelPage.GetProperty("totalAmount").GetDecimal() == 1125 && travelPage.GetProperty("items")[0].GetProperty("amount").GetDecimal() == 25 && travelPage.GetProperty("items")[0].GetProperty("id").GetString() == "insight-25", "split category totals and next-page rows reconcile");
var taggedPage = await InsightPage("byTag", "food");
Check(taggedPage.GetProperty("totalCount").GetInt32() == 22 && taggedPage.GetProperty("totalAmount").GetDecimal() == 2200, "tag filtering matches full comma-delimited tags before counting and paging");
var absentCategory = await InsightPage("byCategory", "Absent");
Check(absentCategory.GetProperty("totalCount").GetInt32() == 0 && absentCategory.GetProperty("totalAmount").GetDecimal() == 0, "empty category aggregate returns zero without loading ledger rows");
Console.WriteLine($"All {checks} automatic matching, profile-isolation and pagination checks passed.");
