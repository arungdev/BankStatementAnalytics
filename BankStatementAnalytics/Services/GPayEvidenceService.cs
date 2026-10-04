using System.Globalization;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using BankStatementAnalytics.Models;
using Common.Framework.Data;
using NHibernate;
using ISession = NHibernate.ISession;
using NHibernate.Linq;

namespace BankStatementAnalytics.Services;

public sealed partial class GPayEvidenceService
{
    public static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };
    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    public static string Normalize(string? value) => Regex.Replace(value?.Trim() ?? "", @"\s+", " ").ToLowerInvariant();
    public static decimal Money(string? value) => decimal.Parse(Regex.Replace(value ?? "", @"[^\d.-]", ""), NumberStyles.Any, CultureInfo.InvariantCulture);
    public static DateTime LocalDate(string? value) => DateTimeOffset.Parse(value!, CultureInfo.InvariantCulture).ToOffset(TimeSpan.FromMinutes(330)).DateTime;
    public static string ExpenseKey(GPayExpenseItem e) => Hash(JsonSerializer.Serialize(new { Time = e.CreationTime, Group = Normalize(e.GroupName), Creator = Normalize(e.Creator), Title = Normalize(e.Title), Total = Money(e.TotalAmount), Items = (e.Items ?? new()).OrderBy(i => Normalize(i.Payer)).Select(i => new { Payer = Normalize(i.Payer), Amount = Money(i.Amount) }) }));
    public static bool IsPaid(string? state) => state is "PAID_RECEIVED" or "MARK_AS_PAID";
    public static string Evidence(string? state) => state == "MARK_AS_PAID" ? "Manual adjustment" : state == "PAID_RECEIVED" ? "Source reported paid" : state == "FAILED" ? "Failed" : "Pending";
    public static bool Imported(SplitGroup g) => g.SourceKey != null || (g.Description?.StartsWith("Google Pay expense created by ", StringComparison.OrdinalIgnoreCase) ?? false);
    public static string Creator(SplitGroup g) => g.CreatorName ?? (g.Description?.StartsWith("Google Pay expense created by ", StringComparison.OrdinalIgnoreCase) == true ? g.Description["Google Pay expense created by ".Length..].Trim() : "You");
    public static bool IsCreator(SplitGroup g, HashSet<string> names) => !Imported(g) || (g.GPayProfileId != null ? Normalize(g.GPayOwnerName) == Normalize(Creator(g)) : names.Contains(Normalize(Creator(g))));
    public static bool IsSelf(SplitGroupMember m, HashSet<string> names) => Imported(m.Group) ? (m.Group.GPayProfileId != null ? Normalize(m.Group.GPayOwnerName) == Normalize(m.ParticipantName) : names.Contains(Normalize(m.ParticipantName))) : m.IsUser || names.Contains(Normalize(m.ParticipantName));

    public static async Task<HashSet<string>> OwnerNames(ISession session, long userId)
    {
        var names = (await session.Query<Account>().Where(a => a.OwnerUserId == userId).ToListAsync()).Select(a => Normalize(a.AccountHolderName)).Where(n => n.Length > 0).ToHashSet();
        foreach (var alias in await session.Query<GPayEvidenceRecord>().Where(r => r.OwnerUserId == userId && r.Kind == "OwnerAlias").ToListAsync()) names.Add(Normalize(JsonSerializer.Deserialize<string>(alias.Payload)));
        return names;
    }

    public static GPayBundle Scan(byte[] bytes, string fileName)
    {
        var bundle = new GPayBundle { FileName = Path.GetFileName(fileName), ArchiveHash = Convert.ToHexString(SHA256.HashData(bytes)) };
        if (bytes.Length > 250_000_000) throw new ArgumentException("Takeout file exceeds 250 MB.");
        if (fileName.EndsWith(".json", StringComparison.OrdinalIgnoreCase)) bundle.Files.Add(new("Group expenses/Group expenses.json", bytes.Length, Encoding.UTF8.GetString(bytes)));
        else if (fileName.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)) {
            using var archive = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);
            long total = 0;
            foreach (var entry in archive.Entries) {
                if (entry.FullName.EndsWith('/')) continue;
                total += entry.Length;
                if (total > 250_000_000 || entry.Length > 30_000_000) throw new ArgumentException("Expanded archive exceeds supported size limits.");
                using var reader = new StreamReader(entry.Open(), Encoding.UTF8, true);
                bundle.Files.Add(new(entry.FullName.Replace('\\', '/'), entry.Length, reader.ReadToEnd()));
            }
        } else throw new ArgumentException("Select a Takeout ZIP or Group expenses JSON.");
        foreach (var file in bundle.Files) {
            int parsed = 0; string kind = "Unsupported";
            try {
                if (file.Path.EndsWith("Group expenses.json", StringComparison.OrdinalIgnoreCase)) {
                    kind = "Expense";
                    var doc = JsonSerializer.Deserialize<GPayTakeoutData>(file.Content, Json) ?? throw new FormatException("Invalid expense document.");
                    foreach (var e in doc.GroupExpenses ?? new()) {
                        try {
                            _ = LocalDate(e.CreationTime);
                            if (e.TotalAmount?.Contains('₹') != true || e.Items?.Any(i=>i.Amount?.Contains('₹') != true) == true) throw new FormatException("Only INR split allocations are supported.");
                            if (string.IsNullOrWhiteSpace(e.Creator) || e.Items == null || e.Items.Any(i => string.IsNullOrWhiteSpace(i.Payer)) || Money(e.TotalAmount) < 0 || e.Items.Any(i => Money(i.Amount) < 0) || e.Items.Sum(i => Money(i.Amount)) != Money(e.TotalAmount)) throw new FormatException("Invalid identity, amount or allocation total.");
                            bundle.Expenses.Add(e); bundle.Records.Add(new(kind, ExpenseKey(e), JsonSerializer.Serialize(e))); parsed++;
                        } catch (Exception ex) when (ex is FormatException or ArgumentException) { bundle.Warnings.Add($"{file.Path}: rejected expense at {e.CreationTime}: {ex.Message}"); }
                    }
                } else if (file.Path.EndsWith("My Activity.html", StringComparison.OrdinalIgnoreCase)) {
                    kind = "Activity";
                    var activities = GPayActivityParser.ParseMyActivityHtml(file.Content);
                    foreach (var a in activities) { bundle.Records.Add(new(kind, Hash(a.RefId ?? JsonSerializer.Serialize(a)), JsonSerializer.Serialize(a))); parsed++; }
                    var cells = Regex.Matches(file.Content, "<div class=\"outer-cell").Count;
                    var headlines = Regex.Matches(file.Content, "body-1\">(?:Paid|Sent|Received)\\s").Count;
                    bundle.Warnings.Add($"Activity inventory: {cells} cells; {headlines} payment headlines; {parsed} parsed payments; {activities.Count(a => a.Status == "Unknown")} unknown statuses.");
                    if (parsed != headlines) bundle.Warnings.Add($"{headlines - parsed} payment records rejected by strict parsing.");
                } else if (file.Path.EndsWith("Cashback rewards.csv", StringComparison.OrdinalIgnoreCase)) {
                    kind = "Cashback"; foreach (var a in GPayActivityParser.ParseCashbackCsv(file.Content)) { bundle.Records.Add(new(kind, Hash(JsonSerializer.Serialize(a)), JsonSerializer.Serialize(a))); parsed++; }
                    var rows = GPayActivityParser.ParseCsv(file.Content).Count - 1; if (rows != parsed) bundle.Warnings.Add($"Cashback: {rows - parsed} rejected rows.");
                } else if (file.Path.Contains("Google transactions/transactions_", StringComparison.OrdinalIgnoreCase) && file.Path.EndsWith(".csv", StringComparison.OrdinalIgnoreCase)) {
                    kind = "Order"; foreach (var a in GPayActivityParser.ParseTransactionsCsv(file.Content)) { bundle.Records.Add(new(kind, Hash(JsonSerializer.Serialize(a)), JsonSerializer.Serialize(a))); parsed++; }
                    var rows = GPayActivityParser.ParseCsv(file.Content).Count - 1; if (rows != parsed) bundle.Warnings.Add($"Orders: {rows - parsed} rejected rows.");
                } else if (file.Path.EndsWith("Voucher rewards.json", StringComparison.OrdinalIgnoreCase)) {
                    kind = "Voucher"; foreach (var a in GPayActivityParser.ParseVouchersJson(file.Content)) { bundle.Records.Add(new(kind, Hash(JsonSerializer.Serialize(a)), JsonSerializer.Serialize(a))); parsed++; }
                } else if (file.Path.EndsWith("Money remittances and requests.csv", StringComparison.OrdinalIgnoreCase)) {
                    kind = "Remittance"; foreach (var row in GPayActivityParser.ParseCsv(file.Content).Skip(1)) { bundle.Records.Add(new(kind, Hash(JsonSerializer.Serialize(row)), JsonSerializer.Serialize(row))); parsed++; }
                }
            } catch (Exception ex) when (ex is JsonException or FormatException or ArgumentException) { bundle.Warnings.Add($"{file.Path}: {ex.Message}"); }
            bundle.Inventory.Add(new { file.Path, file.Bytes, Hash = Hash(file.Content), Kind = kind, Parsed = parsed });
        }
        if (bundle.Records.Count == 0) throw new ArgumentException("No supported records could be parsed.");
        return bundle;
    }

    public static async Task StoreBundle(ISession session, long userId, GPayBundle bundle)
    {
        var stored = (await session.Query<GPayEvidenceRecord>().Where(r => r.OwnerUserId == userId).ToListAsync()).Select(r => (r.Kind, r.SourceKey)).ToHashSet();
        async Task Add(string kind, string key, string payload) {
            if (!stored.Add((kind, key))) return;
            await session.SaveAsync(new GPayEvidenceRecord { OwnerUserId = userId, Kind = kind, SourceKey = key, Payload = payload });
        }
        foreach (var r in bundle.Records) await Add(r.Kind, Hash((bundle.ProfileId == null ? "" : bundle.ProfileId + "|") + r.IdentityKey + r.Payload), JsonSerializer.Serialize(new EvidencePayload(r.IdentityKey, r.Payload, bundle.ArchiveHash, bundle.ProfileId)));
        await Add("Batch", bundle.ProfileId == null ? bundle.ArchiveHash : Hash(bundle.ProfileId + "|" + bundle.ArchiveHash), JsonSerializer.Serialize(new { bundle.FileName, bundle.ArchiveHash, bundle.ProfileId, bundle.Inventory, bundle.Warnings, ImportedUtc = DateTime.UtcNow, ParserVersion = 1 }));
    }

    public async Task<object> Preview(long userId, GPayBundle bundle)
    {
        using var session = DbHelper.GetSession();
        var groups = await session.Query<SplitGroup>().Where(g => g.OwnerUserId == userId).ToListAsync();
        var rows = bundle.Expenses.Select(e => {
            var matches = Corresponding(groups, e, bundle.ProfileId);
            return new { SourceKey = ExpenseKey(e), Title = string.IsNullOrWhiteSpace(e.Title) ? e.GroupName + " Expense" : e.Title, e.GroupName, Creator = e.Creator, e.State, Total = Money(e.TotalAmount), Matches = matches.Select(g => g.Id), Action = matches.Count == 0 ? "New expense" : matches.Count > 1 ? "Ambiguous — review" : matches[0].SourceSnapshot == JsonSerializer.Serialize(e) ? "Unchanged" : "Existing — review source differences" };
        }).ToList();
        return new { bundle.FileName, bundle.ArchiveHash, bundle.Inventory, bundle.Warnings, Expenses = rows, Note = "Import adds source records and missing expenses; existing financial repairs require review." };
    }

    public static string ProfileExpenseKey(GPayExpenseItem e, string? profileId) => profileId == null ? ExpenseKey(e) : Hash(profileId + "|" + ExpenseKey(e));
    public static List<SplitGroup> Corresponding(List<SplitGroup> groups, GPayExpenseItem e, string? profileId = null) {
        groups = groups.Where(group => group.GPayProfileId == profileId).ToList();
        var key = ProfileExpenseKey(e, profileId); var date = LocalDate(e.CreationTime); var title = string.IsNullOrWhiteSpace(e.Title) ? e.GroupName?.Trim() + " Expense" : e.Title.Trim();
        var exact=groups.Where(g => g.SourceKey == key || (Imported(g) && Normalize(g.GroupName) == Normalize(e.GroupName) && Normalize(g.Title) == Normalize(title) && g.TotalAmount == Money(e.TotalAmount) && Math.Abs((g.Date - date).TotalSeconds) < 1)).ToList();
        if(exact.Count>0)return exact;
        // A changed title/amount/allocation is a source-version review, not a new bill.
        return groups.Where(g=>Imported(g)&&Normalize(g.GroupName)==Normalize(e.GroupName)&&Normalize(Creator(g))==Normalize(e.Creator)&&Math.Abs((g.Date-date).TotalSeconds)<1).ToList();
    }

    public static string TxKey(long account, string reference, string bank, string direction) => $"{account}|{reference}|{bank}|{direction}";
}

public sealed class GPayBundle {
    public string? ProfileId {get;set;}
    public string FileName {get;set;}="";public string ArchiveHash {get;set;}="";
    public List<GPaySourceFile> Files {get;}=new();public List<object> Inventory {get;}=new();public List<string> Warnings {get;}=new();
    public List<GPayExpenseItem> Expenses {get;}=new();public List<GPaySourceRow> Records {get;}=new();
}
public record GPaySourceFile(string Path,long Bytes,string Content);
public record GPaySourceRow(string Kind,string IdentityKey,string Payload);
public record EvidencePayload(string IdentityKey,string Data,string ArchiveHash,string? ProfileId = null);
public class ReviewSourceRequest { public int RecordId{get;set;} public bool Accept{get;set;} public long AccountId{get;set;} public string BankReference{get;set;}="";public string BankType{get;set;}="";public string TransactionType{get;set;}=""; public string? MatchMethod{get;set;} }
public class AllocateRepaymentRequest : ReviewSourceRequest {public int SplitId{get;set;} public int MemberId{get;set;}public decimal Amount{get;set;}}
