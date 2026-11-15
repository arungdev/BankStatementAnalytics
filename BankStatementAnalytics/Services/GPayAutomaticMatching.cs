using System.Text.Json;
using System.Text.RegularExpressions;
using BankStatementAnalytics.Models;
using Common.Framework.Data;
using NHibernate;
using NHibernate.Linq;

namespace BankStatementAnalytics.Services;

public sealed partial class GPayEvidenceService
{
    public sealed record ActivityBankLink(long AccountId, string BankReference, string BankType, string TransactionType);
    public sealed record ActivityBankCandidate(ActivityBankLink Bank, string? Payee, DateTime TransactionDate, DateTime? ValueDate, decimal Amount, int CompetingActivities);
    public sealed record ActivityBankMatch(string Status, string Reason, ActivityBankLink? Bank = null,
        List<ActivityBankCandidate>? Candidates = null, int CompetingActivityCount = 0);
    public sealed record AutomaticMatchResult(int Linked, List<GPaySyncChange>? Changes = null);
    private static string BankKey(BankTransaction bank) => TxKey(bank.AccountId, bank.BankReference, bank.BankType, bank.TransactionType);
    private static string BankKey(ReviewSourceRequest bank) => TxKey(bank.AccountId, bank.BankReference, bank.BankType, bank.TransactionType);
    private static ActivityBankLink BankLink(BankTransaction bank) => new(bank.AccountId, bank.BankReference, bank.BankType, bank.TransactionType);
    private static bool ActivityDateAgrees(GPayUpiActivityItem activity, BankTransaction bank) =>
        bank.TransactionDate.Date == activity.Timestamp.Date
        || (bank.Mode == "UPI" && bank.ValueDate?.Date == activity.Timestamp.Date
            && Math.Abs((bank.TransactionDate.Date - activity.Timestamp.Date).Days) == 1);
    private static List<string> ActivityIds(string? note) => Regex.Split(note ?? "", @"\s+\|\s+|\r?\n")
        .Where(part => Regex.IsMatch(part.Trim(), @"^GPay(?:\s+(?:Sent|Paid|Received))?:", RegexOptions.IgnoreCase))
        .Select(part => Regex.Match(part, @"\(Ref:\s*([^)]+)\)|;\s*source\s+([^;]+);"))
        .Where(match => match.Success).Select(match => (match.Groups[1].Success ? match.Groups[1].Value : match.Groups[2].Value).Trim()).ToList();

    private sealed record PayeeAlias(string? ProfileId, long AccountId, string BankType, string Mode, string RoutingCode, bool Credit, string SourceName, string BankName);
    private static string PayeeName(string? name) => Regex.Replace(Normalize(name), @"[^\p{L}\p{N}]+", " ").Trim();
    private static string StatementPayee(BankTransaction bank)
    {
        var field = Regex.Match(bank.Description ?? "", @"^UPI/[^/]+/(?:DR|CR)/([^/]+)/", RegexOptions.IgnoreCase);
        return field.Success ? PayeeName(field.Groups[1].Value) : "";
    }
    private static string PayeeRoutingCode(BankTransaction bank)
    {
        var field = Regex.Match(bank.Description ?? "", @"^UPI/[^/]+/(?:DR|CR)/[^/]+/([^/]+)/", RegexOptions.IgnoreCase);
        return field.Success ? Normalize(field.Groups[1].Value) : "";
    }

    private static GPayAutoImportConfigDto? ConfigForProfile(List<GPayEvidenceRecord> records, string? profileId) =>
        records.Where(record => record.Kind == (profileId == null ? "PrimaryConfig" : "Profile"))
            .Select(record => JsonSerializer.Deserialize<GPayAutoImportConfigDto>(record.Payload, Json)!)
            .FirstOrDefault(config => profileId == null || config.ProfileId == profileId);

    private static HashSet<PayeeAlias> ConfirmedPayeeAliases(List<GPayEvidenceRecord> records, List<Account> accounts, List<BankTransaction> banks)
    {
        var aliases = new HashSet<PayeeAlias>();
        var bankIndex = banks.ToDictionary(BankKey);
        var sources = records.Where(record => record.Kind == "Activity").ToDictionary(record => record.Id);
        var profiles = records.Where(record => record.Kind == "Profile").Select(record => JsonSerializer.Deserialize<GPayAutoImportConfigDto>(record.Payload, Json)!).ToDictionary(profile => profile.ProfileId!);
        var decisions = records.Where(record => record.Kind == "Decision").Select(record => JsonSerializer.Deserialize<ReviewSourceRequest>(record.Payload, Json)!)
            .GroupBy(decision => decision.RecordId).Where(group => group.Count() == 1).Select(group => group.Single());
        foreach (var decision in decisions.Where(decision => decision.Accept && decision.MatchMethod == "Manual"))
        {
            // Learn only from an explicit confirmation, never from an automatic inference.
            if (!sources.TryGetValue(decision.RecordId, out var source) || !bankIndex.TryGetValue(BankKey(decision), out var bank)) continue;
            var payload = JsonSerializer.Deserialize<EvidencePayload>(source.Payload, Json)!;
            var activity = JsonSerializer.Deserialize<GPayUpiActivityItem>(payload.Data, Json)!;
            var credit = activity.Type == "Received";
            if (activity.Status != "Completed" || activity.Amount <= 0 || activity.Type is not ("Paid" or "Sent" or "Received")
                || string.IsNullOrWhiteSpace(activity.CounterPartyName) || string.IsNullOrWhiteSpace(activity.AccountSuffix)
                || bank.TransactionDate.Date != activity.Timestamp.Date || bank.TransferGroupId != null || bank.Mode != "UPI"
                || (credit ? bank.Credit : bank.Debit) != activity.Amount || (credit ? bank.Debit : bank.Credit) != 0) continue;
            var accountConfig = ConfigForProfile(records, payload.ProfileId);
            if (payload.ProfileId != null && accountConfig == null) continue;
            var configuredAccounts = accountConfig?.BankAccountIds ?? new List<long>();
            var eligibleAccounts = configuredAccounts.Count > 0
                ? accounts.Where(account => configuredAccounts.Contains(account.Id)).ToList()
                : accounts;
            var hinted = eligibleAccounts.Where(account => account.AccountNumber?.EndsWith(activity.AccountSuffix, StringComparison.Ordinal) == true).ToList();
            if (configuredAccounts.Count > 0)
            {
                if (!configuredAccounts.Contains(bank.AccountId)) continue;
            }
            else if (hinted.Count != 1 || hinted[0].Id != bank.AccountId) continue;
            var name = StatementPayee(bank);
            var routing = PayeeRoutingCode(bank);
            if (routing.Length == 0 || Regex.Replace(name, @"[^\p{L}\p{N}]", "").Length < 5) continue;
            aliases.Add(new(payload.ProfileId, bank.AccountId, bank.BankType, bank.Mode, routing, credit, PayeeName(activity.CounterPartyName), name));
        }
        return aliases;
    }

    private static bool TruncatedIobPayeeAgrees(GPayUpiActivityItem activity, BankTransaction bank)
    {
        // Actual IOB UPI statements abbreviate this field to 14 characters. A trailing
        // blank can leave 13; PDF extraction can insert a space and leave 15. Compare
        // only that statement field, never arbitrary substrings or edited merchant names.
        // A unique source account hint is required by the caller for this weaker evidence.
        if (bank.BankType != "IOB" || bank.Mode != "UPI" || string.IsNullOrWhiteSpace(activity.AccountSuffix)) return false;
        var field = Regex.Match(bank.Description ?? "", @"^UPI/[^/]+/(?:DR|CR)/([^/]+)/", RegexOptions.IgnoreCase);
        if (!field.Success) return false;
        var name = Normalize(field.Groups[1].Value);
        if (name.Length is < 13 or > 15) return false;
        var compactBank = Regex.Replace(name, @"[^\p{L}\p{N}]", "");
        var compactSource = Regex.Replace(Normalize(activity.CounterPartyName), @"[^\p{L}\p{N}]", "");
        return compactBank.Length >= 10 && compactSource.Length > compactBank.Length
            && compactSource.StartsWith(compactBank, StringComparison.Ordinal);
    }

    private static bool ActivityPayeeAgrees(GPayUpiActivityItem activity, BankTransaction bank, string? profileId, HashSet<PayeeAlias> aliases, out string? evidence)
    {
        evidence = null;
        var sourceIds = ActivityIds(bank.Note);
        if (sourceIds.Count > 0) return !string.IsNullOrWhiteSpace(activity.RefId) && sourceIds.All(id => id == activity.RefId);
        // A GPay receipt's UPI transaction ID is a bank-side payment identifier,
        // unlike RefId (the Google activity ID). Exact reference agreement can
        // resolve merchant-vs-account-holder naming differences safely.
        var upiId = Regex.Replace(activity.UpiTransactionId ?? "", @"\D", "");
        if (upiId.Length is >= 10 and <= 20)
        {
            var bankIds = new[] { bank.BankReference, Regex.Match(bank.Description ?? "", @"^UPI/([^/]+)/", RegexOptions.IgnoreCase).Groups[1].Value }
                .Select(value => Regex.Replace(value ?? "", @"\D", ""));
            if (bankIds.Any(id => id == upiId))
            { evidence = "the UPI transaction ID exactly matches the bank reference"; return true; }
        }
        var tokens = Regex.Split(Normalize(activity.CounterPartyName), @"[^\p{L}\p{N}]+").Where(token => token.Length >= 3).ToList();
        if (!string.IsNullOrWhiteSpace(activity.CounterPartyName) && tokens.Count == 0) return false;
        var text = Normalize(bank.Description + " " + bank.Narration + " " + bank.UpiVpa + " " + bank.CounterParty?.Name);
        var bankTokens = Regex.Split(text, @"[^\p{L}\p{N}]+").ToHashSet();
        if (tokens.All(bankTokens.Contains)) return true;
        if (TruncatedIobPayeeAgrees(activity, bank))
        { evidence = "the IOB statement payee is a truncated prefix of the GPay name"; return true; }
        if (!string.IsNullOrWhiteSpace(activity.AccountSuffix) && aliases.Contains(new(profileId, bank.AccountId, bank.BankType, bank.Mode, PayeeRoutingCode(bank), activity.Type == "Received", PayeeName(activity.CounterPartyName), StatementPayee(bank))))
        { evidence = "the exact payee name pair was previously confirmed for this GPay profile and bank account"; return true; }
        return false;
    }

    // A bank row must be unique from BOTH sides across transaction AND explicit value dates.
    // No nearest-date or first-row selection.
    public static Dictionary<int, ActivityBankMatch> PlanAutomaticActivityMatches(
        List<GPayEvidenceRecord> records, List<Account> accounts, List<BankTransaction> banks)
    {
        var owned = accounts.Select(account => account.Id).ToHashSet();
        banks = banks.Where(bank => owned.Contains(bank.AccountId)).ToList();
        var aliases = ConfirmedPayeeAliases(records, accounts, banks);
        var bankIndex = banks.ToDictionary(BankKey);
        var decisions = records.Where(record => record.Kind == "Decision")
            .Select(record => JsonSerializer.Deserialize<ReviewSourceRequest>(record.Payload, Json)!).ToList();
        var decisionsByRecord = decisions.ToLookup(decision => decision.RecordId);
        // Index both allowed dates once instead of scanning the entire bank ledger per activity.
        var datedBanks = banks.SelectMany(bank => {
            var dates = new List<DateTime> { bank.TransactionDate.Date };
            if (bank.Mode == "UPI" && bank.ValueDate.HasValue && Math.Abs((bank.TransactionDate.Date - bank.ValueDate.Value.Date).Days) == 1)
                dates.Add(bank.ValueDate.Value.Date);
            return dates.Select(date => (Date: date, Credit: bank.Credit > 0, Amount: bank.Credit > 0 ? bank.Credit : bank.Debit, Bank: bank));
        }).ToLookup(entry => (entry.Date, entry.Credit, entry.Amount), entry => entry.Bank);
        var activities = records.Where(record => record.Kind == "Activity")
            .Select(record => (Record: record, Payload: JsonSerializer.Deserialize<EvidencePayload>(record.Payload, Json)!)).ToList();
        var activityIds = activities.Select(activity => activity.Record.Id).ToHashSet();
        var reserved = decisions.Where(decision => decision.Accept && activityIds.Contains(decision.RecordId)).Select(BankKey).ToHashSet();
        var profiles = records.Where(record => record.Kind == "Profile").Select(record => JsonSerializer.Deserialize<GPayAutoImportConfigDto>(record.Payload, Json)!).ToDictionary(profile => profile.ProfileId!);
        var duplicateCopies = new HashSet<int>();
        var conflictingDuplicates = new HashSet<int>();
        foreach (var group in activities.GroupBy(activity => (activity.Payload.ProfileId, activity.Payload.IdentityKey)).Where(group => group.Count() > 1))
        {
            var versions = group.ToList();
            var normalized = versions.Select(version => JsonSerializer.Serialize(JsonSerializer.Deserialize<GPayUpiActivityItem>(version.Payload.Data, Json), Json)).Distinct(StringComparer.Ordinal).ToList();
            if (normalized.Count == 1)
            {
                var canonical = versions.OrderByDescending(version => decisionsByRecord[version.Record.Id].Any(decision => decision.Accept))
                    .ThenBy(version => version.Record.Id).First();
                duplicateCopies.UnionWith(versions.Where(version => version.Record.Id != canonical.Record.Id).Select(version => version.Record.Id));
            }
            else conflictingDuplicates.UnionWith(versions.Select(version => version.Record.Id));
        }
        var result = new Dictionary<int, ActivityBankMatch>();
        var candidates = new Dictionary<int, List<BankTransaction>>();
        var unmatchedReasons = new Dictionary<int, string>();
        var payeeEvidence = new Dictionary<string, string>();
        var valueDateMatches = new HashSet<string>();
        foreach (var (record, payload) in activities)
        {
            if (duplicateCopies.Contains(record.Id))
            { result[record.Id] = new("Duplicate", "This is an identical copy of another imported GPay activity; only one source record is used for matching."); continue; }
            var activity = JsonSerializer.Deserialize<GPayUpiActivityItem>(payload.Data, Json)!;
            var credit = activity.Type == "Received";
            bool AmountAgrees(BankTransaction bank) => (credit ? bank.Credit : bank.Debit) == activity.Amount && (credit ? bank.Debit : bank.Credit) == 0;
            var previous = decisionsByRecord[record.Id].ToList();
            var confirmed = previous.Where(decision => decision.Accept).ToList();
            if (confirmed.Count > 0)
            {
                var bank = confirmed.Count == 1 && bankIndex.TryGetValue(BankKey(confirmed[0]), out var found) ? found : null;
                result[record.Id] = bank != null && AmountAgrees(bank)
                    ? new("Linked", confirmed[0].MatchMethod switch {
                        "AutomaticSameDay" => "Automatically matched by date, amount, direction and available source identifiers.",
                        "AutomaticValueDate" => $"Automatically matched using the bank value date ({bank.ValueDate:dd MMM yyyy}); its transaction date is {bank.TransactionDate:dd MMM yyyy}. Amount, direction and available account/payee information agree.",
                        _ => "Previously confirmed bank transaction."
                    }, BankLink(bank))
                    : new("Unavailable", "The existing link is missing or its bank amount has changed.");
                continue;
            }
            if (activity.Status != "Completed" || activity.Amount <= 0 || activity.Type is not ("Sent" or "Paid" or "Received"))
            { result[record.Id] = new("Not eligible", "Only completed payments with a known amount and direction are matched."); continue; }
            if (previous.Any(decision => !decision.Accept))
            { result[record.Id] = new("Unlinked", "A previous bank match was rejected; automatic matching will not override that decision."); continue; }
            if (conflictingDuplicates.Contains(record.Id))
            { result[record.Id] = new("Ambiguous", "Multiple source versions exist for this activity."); }
            var accountConfig = ConfigForProfile(records, payload.ProfileId);
            if (payload.ProfileId != null && accountConfig == null) { result[record.Id] = new("Unlinked", "The source GPay profile is unavailable."); continue; }
            var configuredAccounts = accountConfig?.BankAccountIds ?? new List<long>();
            var explicitlyConfigured = configuredAccounts.Count > 0;
            var profileAccounts = explicitlyConfigured ? accounts.Where(account => configuredAccounts.Contains(account.Id)).ToList() : accounts;
            var suffixAccounts = explicitlyConfigured || string.IsNullOrWhiteSpace(activity.AccountSuffix)
                ? profileAccounts
                : profileAccounts.Where(account => account.AccountNumber?.EndsWith(activity.AccountSuffix, StringComparison.Ordinal) == true).ToList();
            if (!explicitlyConfigured && !string.IsNullOrWhiteSpace(activity.AccountSuffix) && suffixAccounts.Count != 1)
            { result[record.Id] = new("Unlinked", "The source account hint does not identify a unique imported bank account."); continue; }
            var eligibleAccounts = suffixAccounts.Select(account => account.Id).ToHashSet();
            var dateMatches = datedBanks[(activity.Timestamp.Date, credit, activity.Amount)].Where(bank => eligibleAccounts.Contains(bank.AccountId)
                && ActivityDateAgrees(activity, bank) && AmountAgrees(bank)).ToList();
            var eligible = dateMatches.Where(bank => bank.TransferGroupId == null && bank.Mode != "TRANSFER" && !reserved.Contains(BankKey(bank))).ToList();
            unmatchedReasons[record.Id] = dateMatches.Count == 0
                ? "No imported bank payment matches the transaction date or an eligible explicit bank value date, amount, direction and account."
                : eligible.Count == 0
                    ? "Matching bank payments are already linked to another GPay activity or excluded as own-account transfers."
                    : "Bank payments with a matching transaction/value date, amount and direction exist, but their payee names or stored GPay identifiers do not agree.";
            var payeeMatches = eligible.Where(bank => {
                    var agrees = ActivityPayeeAgrees(activity, bank, payload.ProfileId, aliases, out var evidence);
                    if (evidence != null) payeeEvidence[record.Id + "|" + BankKey(bank)] = evidence;
                    if (agrees && bank.TransactionDate.Date != activity.Timestamp.Date) valueDateMatches.Add(record.Id + "|" + BankKey(bank));
                    return agrees;
                }).ToList();
            // Uniqueness cannot override conflicting payee or source identifiers.
            candidates[record.Id] = payeeMatches;
        }
        var competingSources = candidates.SelectMany(pair => pair.Value.Select(bank => (Key: BankKey(bank), Id: pair.Key)))
            .GroupBy(pair => pair.Key).ToDictionary(group => group.Key, group => group.Select(pair => pair.Id).ToHashSet());
        foreach (var (recordId, matches) in candidates) {
            var competingIds = matches.SelectMany(bank => competingSources[BankKey(bank)]).Where(id => id != recordId).ToHashSet();
            var options = matches.OrderBy(bank => bank.TransactionDate).ThenBy(bank => bank.AccountId).ThenBy(bank => bank.BankReference, StringComparer.Ordinal)
                .Select(bank => new ActivityBankCandidate(BankLink(bank), bank.CounterParty?.Name, bank.TransactionDate, bank.ValueDate,
                    bank.Credit > 0 ? bank.Credit : bank.Debit, competingSources[BankKey(bank)].Count - 1)).ToList();
            if (result.TryGetValue(recordId, out var existing)) {
                if (existing.Status == "Ambiguous") result[recordId] = existing with { Candidates = options, CompetingActivityCount = competingIds.Count };
                continue;
            }
            if (matches.Count == 1 && competingIds.Count == 0)
            {
                var bank = matches[0];
                var key = recordId + "|" + BankKey(bank);
                var reason = valueDateMatches.Contains(key)
                    ? $"Unique UPI payment with exact amount and direction; the bank value date ({bank.ValueDate:dd MMM yyyy}) matches GPay, while its transaction date is {bank.TransactionDate:dd MMM yyyy}."
                    : "Unique payment on the same date with exact amount, direction and available account/payee information.";
                if (payeeEvidence.TryGetValue(key, out var evidence)) reason += " Payee evidence: " + evidence + ".";
                result[recordId] = new("Ready", reason, BankLink(bank));
            }
            else result[recordId] = matches.Count == 0 ? new("No bank match", unmatchedReasons[recordId])
                : new("Ambiguous", $"{matches.Count} possible bank payment{(matches.Count == 1 ? " matches" : "s match")} the available date, amount, direction and account/payee facts."
                    + (competingIds.Count > 0 ? $" {competingIds.Count} other GPay payment{(competingIds.Count == 1 ? " also fits" : "s also fit")} these bank payments." : "")
                    + " The available identifiers do not establish a unique pairing; no automatic link was made.",
                    Candidates: options, CompetingActivityCount: competingIds.Count);
        }
        return result;
    }

    public async Task<AutomaticMatchResult> AutoMatchActivities(long userId, string? profileId = null, bool restrictToProfile = false)
    {
        using var session = BankStatementAnalytics.Tenancy.AppDatabase.GetSession();
        using var transaction = session.BeginTransaction();
        // Serialize automatic runs for this owner, including repeated browser mounts.
        var accounts = await session.Query<Account>().Where(account => account.OwnerUserId == userId).OrderBy(account => account.Id).ToListAsync();
        foreach (var account in accounts) await session.LockAsync(account, LockMode.Upgrade);
        var ids = accounts.Select(account => account.Id).ToList();
        var records = await session.Query<GPayEvidenceRecord>().Where(record => record.OwnerUserId == userId && record.Kind != "SyncHistory").ToListAsync();
        var banks = await session.Query<BankTransaction>().Where(bank => ids.Contains(bank.AccountId)).ToListAsync();
        var plans = PlanAutomaticActivityMatches(records, accounts, banks);
        var linked = 0;
        var changes = new List<GPaySyncChange>();
        foreach (var (recordId, match) in plans.Where(pair => pair.Value.Status == "Ready"))
        {
            var source = records.Single(record => record.Id == recordId);
            var payload = JsonSerializer.Deserialize<EvidencePayload>(source.Payload, Json)!;
            if (restrictToProfile && payload.ProfileId != profileId) continue;
            var link = match.Bank!;
            var bank = banks.Single(bank => BankKey(bank) == TxKey(link.AccountId, link.BankReference, link.BankType, link.TransactionType));
            await session.LockAsync(bank, LockMode.Upgrade);
            await session.RefreshAsync(bank);
            // Manual confirmations also lock this bank row: recheck decisions after acquiring it.
            var current = await session.Query<GPayEvidenceRecord>().Where(record => record.OwnerUserId == userId && record.Kind == "Decision").ToListAsync();
            var decisions = current.Select(record => JsonSerializer.Deserialize<ReviewSourceRequest>(record.Payload, Json)!).ToList();
            if (decisions.Any(decision => decision.RecordId == recordId || decision.Accept && BankKey(decision) == BankKey(bank) && records.Any(record => record.Id == decision.RecordId && record.Kind == "Activity"))) continue;
            var aliases = ConfirmedPayeeAliases(records.Where(record => record.Kind != "Decision").Concat(current).ToList(), accounts, banks);
            var activity = JsonSerializer.Deserialize<GPayUpiActivityItem>(payload.Data, Json)!;
            if (bank.TransferGroupId != null || bank.Mode == "TRANSFER" || !ActivityDateAgrees(activity, bank)
                || (activity.Type == "Received" ? bank.Credit : bank.Debit) != activity.Amount
                || (activity.Type == "Received" ? bank.Debit : bank.Credit) != 0) continue;
            var payeeAgrees = ActivityPayeeAgrees(activity, bank, payload.ProfileId, aliases, out _);
            if (!payeeAgrees) continue;
            var method = bank.TransactionDate.Date == activity.Timestamp.Date ? "AutomaticSameDay" : "AutomaticValueDate";
            var request = new ReviewSourceRequest { RecordId = recordId, Accept = true, AccountId = link.AccountId, BankReference = link.BankReference, BankType = link.BankType, TransactionType = link.TransactionType, MatchMethod = method };
            if (!ActivityIds(bank.Note).Contains(activity.RefId ?? ""))
            {
                var context = $"GPay {activity.Type}: {activity.CounterPartyName ?? "unnamed party"}; source {activity.RefId}; {activity.Timestamp:O}";
                bank.Note = string.IsNullOrWhiteSpace(bank.Note) ? context : bank.Note + " | " + context;
                await session.UpdateAsync(bank);
            }
            await session.SaveAsync(new GPayEvidenceRecord { OwnerUserId = userId, Kind = "Decision", SourceKey = Hash($"{recordId}|{link.AccountId}|{link.BankReference}|{link.BankType}|{link.TransactionType}"), Payload = JsonSerializer.Serialize(request) });
            await session.SaveAsync(new GPayEvidenceRecord { OwnerUserId = userId, Kind = "ReviewAudit", SourceKey = Hash(Guid.NewGuid().ToString()), Payload = JsonSerializer.Serialize(new { Request = request, Method = method, Reason = match.Reason, DecidedUtc = DateTime.UtcNow }) });
            linked++;
            changes.Add(new("Bank link", "Linked", recordId, activity.CounterPartyName ?? activity.Type, activity.Amount,
                $"Account {bank.AccountId}; bank reference {bank.BankReference}. {match.Reason}"));
        }
        await transaction.CommitAsync();
        return new AutomaticMatchResult(linked, changes);
    }
}
