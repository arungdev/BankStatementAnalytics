using System.Text.Json;
using System.Globalization;
using BankStatementAnalytics.Models;
using Common.Framework.Data;
using NHibernate.Linq;

namespace BankStatementAnalytics.Services;

public sealed partial class GPayEvidenceService
{
    public sealed record ActivityPageRow(int Id, DateTime CreatedUtc, EvidencePayload Source, string? ProfileName, ActivityBankMatch? BankMatch);
    public sealed record ActivityPageResult(List<ActivityPageRow> Records, int TotalCount, int Page, int PageSize);

    public async Task<ActivityPageResult> ActivityPage(long userId, string section, int page, int pageSize,
        string profileId, string search, string sort, string direction)
    {
        var kind = section switch {
            "activities" => "Activity", "orders" => "Order", "rewards" => "Cashback", "vouchers" => "Voucher",
            _ => throw new ArgumentException("Unknown activity section.")
        };
        if (page < 0 || pageSize < 1 || pageSize > 100 || sort is not ("date" or "name" or "amount") || direction is not ("asc" or "desc"))
            throw new ArgumentException("Invalid pagination or sorting options.");

        using var session = DbHelper.GetSession();
        var result = await ReadActivityPageAsync(session, userId, kind, page, pageSize, profileId, search, sort, direction);
        var pageRecords = result.Records;
        var totalCount = result.TotalCount;
        page = result.Page;
        // Matching must see all activities, including those outside the requested page,
        // so competing payments cannot be mistaken for unique bank matches.
        var records = await session.Query<GPayEvidenceRecord>()
            .Where(r => r.OwnerUserId == userId && (r.Kind == "Profile" || (kind == "Activity" && (r.Kind == "Decision" || r.Kind == "Activity"))))
            .ToListAsync();
        var profiles = records.Where(r => r.Kind == "Profile")
            .Select(r => JsonSerializer.Deserialize<GPayAutoImportConfigDto>(r.Payload, Json)!)
            .ToDictionary(p => p.ProfileId!, p => p.ProfileName);
        var matches = new Dictionary<int, ActivityBankMatch>();
        if (kind == "Activity" && pageRecords.Count > 0) {
            var accounts = await session.Query<Account>().Where(a => a.OwnerUserId == userId).ToListAsync();
            var accountIds = accounts.Select(a => a.Id).ToList();
            var banks = await session.Query<BankTransaction>().Where(b => accountIds.Contains(b.AccountId)).Fetch(b => b.CounterParty).ToListAsync();
            matches = PlanAutomaticActivityMatches(records, accounts, banks);
            var confirmed = records.Where(r => r.Kind == "Decision")
                .Select(r => JsonSerializer.Deserialize<ReviewSourceRequest>(r.Payload, Json)!)
                .Where(d => d.Accept).GroupBy(d => d.RecordId);
            foreach (var group in confirmed.Where(g => !matches.ContainsKey(g.Key) && g.Count() == 1)) {
                var decision = group.Single();
                var bank = banks.SingleOrDefault(b => BankKey(b) == BankKey(decision));
                if (bank != null) matches[group.Key] = new ActivityBankMatch("Linked", "Previously confirmed bank transaction.", BankLink(bank));
            }
        }
        var rows = pageRecords.Select(r => {
            var source = JsonSerializer.Deserialize<EvidencePayload>(r.Payload, Json)!;
            return new ActivityPageRow(r.Id, r.CreatedUtc, source,
                source.ProfileId == null ? "Primary GPay" : profiles.GetValueOrDefault(source.ProfileId, "GPay profile"), matches.GetValueOrDefault(r.Id));
        });
        return new ActivityPageResult(rows.ToList(), totalCount, page, pageSize);
    }

    public static async Task<(IList<GPayEvidenceRecord> Records, int TotalCount, int Page)> ReadActivityPageAsync(
        NHibernate.ISession session, long userId, string kind, int page, int pageSize,
        string profileId, string search, string sort, string direction)
    {
        if (page < 0 || pageSize < 1 || pageSize > 100 || sort is not ("date" or "name" or "amount") || direction is not ("asc" or "desc"))
            throw new ArgumentException("Invalid pagination or sorting options.");
        var dialect = session.GetSessionImplementation().Factory.Dialect;
        var postgres = dialect is NHibernate.Dialect.PostgreSQLDialect;
        var sqlite = dialect is NHibernate.Dialect.SQLiteDialect;
        if (!postgres && !sqlite) throw new ArgumentException("Activity pagination requires PostgreSQL or SQLite.");
        string PayloadField(string field) => postgres ? $"cast(r.Payload as json)->>'{field}'" : $"json_extract(r.Payload, '$.{field}')";
        var sourceJson = postgres ? $"cast(({PayloadField("Data")}) as json)" : PayloadField("Data");
        string SourceField(string field) => postgres ? $"({sourceJson})->>'{field}'" : $"json_extract({sourceJson}, '$.{field}')";
        var where = "r.OwnerUserId = :owner and r.Kind = :kind";
        if (profileId != "all") where += $" and coalesce({PayloadField("ProfileId")}, 'default') = :profile";
        if (!string.IsNullOrEmpty(search)) {
            var decoded = postgres ? $"(select string_agg(value, ' ') from json_each_text({sourceJson}))" : $"(select group_concat(value, ' ') from json_each({sourceJson}))";
            where += $" and (lower(r.Payload) like :search escape '!' or lower({decoded}) like :search escape '!')";
        }
        var nameSql = "coalesce(" + string.Join(",", new[] { "CounterPartyName", "Description", "Summary", "Type" }.Select(f => $"nullif({SourceField(f)}, '')")) + ", 'Unnamed payment')";
        var dateSql = "coalesce(" + string.Join(",", new[] { "Timestamp", "Time", "Date", "ExpiryTimestamp" }.Select(f => $"nullif({SourceField(f)}, '')")) + ", '1970-01-01')";
        var sortSql = sort switch {
            "name" => $"lower({nameSql})",
            "amount" => $"cast(coalesce({SourceField("Amount")}, '0') as decimal)",
            _ => postgres ? $"extract(epoch from cast({dateSql} as timestamptz))" : $"cast(strftime('%s', {dateSql}) as integer)"
        };
        NHibernate.ISQLQuery Bind(NHibernate.ISQLQuery query) {
            query.SetParameter("owner", userId).SetParameter("kind", kind);
            if (profileId != "all") query.SetParameter("profile", profileId);
            if (!string.IsNullOrEmpty(search)) query.SetParameter("search", "%" + search.ToLowerInvariant().Replace("!", "!!").Replace("%", "!%").Replace("_", "!_") + "%");
            return query;
        }
        var totalCount = Convert.ToInt32(await Bind(session.CreateSQLQuery($"select count(*) from gpay_evidence_records r where {where}")).UniqueResultAsync());
        page = Math.Min(page, Math.Max(0, (totalCount - 1) / pageSize));
        var pageRecords = await Bind(session.CreateSQLQuery($"select {{r.*}} from gpay_evidence_records r where {where} order by {sortSql} {direction}, r.Id asc")
            .AddEntity("r", typeof(GPayEvidenceRecord))).SetFirstResult(page * pageSize).SetMaxResults(pageSize).ListAsync<GPayEvidenceRecord>();
        return (pageRecords, totalCount, page);
    }

    public static ActivityPageResult PageActivities(IEnumerable<ActivityPageRow> rows, int page, int pageSize,
        string profileId, string search, string sort, string direction)
    {
        string Text(JsonElement data, params string[] fields) => fields.Select(f => data.TryGetProperty(f, out var value) ? value.ToString() : "")
            .FirstOrDefault(value => !string.IsNullOrEmpty(value)) ?? "";
        var filtered = rows.Where(r => profileId == "all" || (r.Source.ProfileId ?? "default") == profileId)
            .Select(r => {
                using var document = JsonDocument.Parse(r.Source.Data);
                var data = document.RootElement;
                var date = Text(data, "Timestamp", "Time", "Date", "ExpiryTimestamp");
                return new { Row = r, Name = Text(data, "CounterPartyName", "Description", "Summary", "Type"),
                    Date = DateTimeOffset.TryParse(date, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed) ? parsed.ToUnixTimeMilliseconds() : 0,
                    Amount = data.TryGetProperty("Amount", out var amount) && amount.TryGetDecimal(out var number) ? number : 0,
                    Search = string.IsNullOrEmpty(search) ? "" : JsonSerializer.Serialize(r, Json) + " "
                        + string.Join(" ", data.EnumerateObject().Select(property => property.Value.ToString())) };
            }).Where(r => string.IsNullOrEmpty(search) || r.Search.Contains(search, StringComparison.OrdinalIgnoreCase)).ToList();
        IEnumerable<ActivityPageRow> ordered = sort switch {
            "name" => direction == "asc" ? filtered.OrderBy(r => r.Name, StringComparer.OrdinalIgnoreCase).ThenBy(r => r.Row.Id).Select(r => r.Row) : filtered.OrderByDescending(r => r.Name, StringComparer.OrdinalIgnoreCase).ThenBy(r => r.Row.Id).Select(r => r.Row),
            "amount" => direction == "asc" ? filtered.OrderBy(r => r.Amount).ThenBy(r => r.Row.Id).Select(r => r.Row) : filtered.OrderByDescending(r => r.Amount).ThenBy(r => r.Row.Id).Select(r => r.Row),
            _ => direction == "asc" ? filtered.OrderBy(r => r.Date).ThenBy(r => r.Row.Id).Select(r => r.Row) : filtered.OrderByDescending(r => r.Date).ThenBy(r => r.Row.Id).Select(r => r.Row)
        };
        page = Math.Min(page, Math.Max(0, (filtered.Count - 1) / pageSize));
        return new ActivityPageResult(ordered.Skip(page * pageSize).Take(pageSize).ToList(), filtered.Count, page, pageSize);
    }
}
