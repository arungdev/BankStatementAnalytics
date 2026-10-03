using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace BankStatementAnalytics.Services
{
    public class GPayUpiActivityItem
    {
        public string Type { get; set; } = string.Empty; // "Paid", "Sent", "Received"
        public decimal Amount { get; set; }
        public string? CounterPartyName { get; set; }
        public string? AccountSuffix { get; set; }
        public DateTime Timestamp { get; set; }
        public string? RefId { get; set; }
        public string? Status { get; set; }
    }

    public class GPayCashbackItem
    {
        public DateTime Date { get; set; }
        public string Currency { get; set; } = "INR";
        public decimal Amount { get; set; }
        public string Description { get; set; } = string.Empty;
    }

    public class GPayOrderTransactionItem
    {
        public DateTime Time { get; set; }
        public string TransactionId { get; set; } = string.Empty;
        public string Description { get; set; } = string.Empty;
        public string Product { get; set; } = string.Empty;
        public string PaymentMethod { get; set; } = string.Empty;
        public string Status { get; set; } = string.Empty;
        public decimal Amount { get; set; }
    }

    public class GPayVoucherItem
    {
        public string Code { get; set; } = string.Empty;
        public string Details { get; set; } = string.Empty;
        public string Summary { get; set; } = string.Empty;
        public DateTime? ExpiryTimestamp { get; set; }
        public bool IsActive => ExpiryTimestamp.HasValue && ExpiryTimestamp.Value > DateTime.UtcNow;
    }

    public static class GPayActivityParser
    {
        private static readonly Regex HeadlineRegex = new(
            @"^(Paid|Sent|Received)\s+([^\s]+)(.*)$",
            RegexOptions.Compiled | RegexOptions.Singleline);

        private static readonly Regex AccountSuffixRegex = new(
            @"using Bank Account\s+.*?(\d{4})",
            RegexOptions.Compiled | RegexOptions.IgnoreCase);

        private static readonly Regex CounterpartyRegex = new(
            @"(?:to|from)\s+(.+?)(?:\s+using Bank Account|$)",
            RegexOptions.Compiled | RegexOptions.IgnoreCase);

        private static readonly Regex CleanNumberRegex = new(
            @"[^\d\.]",
            RegexOptions.Compiled);

        public static List<GPayUpiActivityItem> ParseMyActivityHtml(string html)
        {
            var results = new List<GPayUpiActivityItem>();
            foreach (var cell in Regex.Split(html ?? "", "(?=<div class=\"outer-cell)"))
            {
                if (!cell.StartsWith("<div class=\"outer-cell")) continue;
                var main = Regex.Match(cell, "content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1\">(.*?)</div>", RegexOptions.Singleline);
                if (!main.Success) continue;
                var lines = main.Groups[1].Value.Split("<br>");
                if (lines.Length < 2) continue;
                var headline = System.Net.WebUtility.HtmlDecode(lines[0]).Trim();
                var hm = HeadlineRegex.Match(headline);
                if (!hm.Success || !hm.Groups[2].Value.Contains('₹') || !decimal.TryParse(CleanNumberRegex.Replace(hm.Groups[2].Value, ""), NumberStyles.Any, CultureInfo.InvariantCulture, out var amount)) continue;
                var date = lines[1].Replace("Sept ", "Sep ").Replace(" IST", " +05:30");
                if (!DateTimeOffset.TryParseExact(date, "d MMM yyyy, HH:mm:ss zzz", CultureInfo.InvariantCulture, DateTimeStyles.None, out var instant)) continue;
                var detail = Regex.Match(cell, "<b>Details:</b><br>(.*?)(?:<b>|</div>)", RegexOptions.Singleline);
                var values = detail.Groups[1].Value.Split("<br>").Select(v => System.Net.WebUtility.HtmlDecode(v.Replace("&emsp;", "")).Trim()).ToList();
                var states = new[] { "Completed", "Failed", "Cancelled", "Pending" };
                var remainder = hm.Groups[3].Value;
                results.Add(new GPayUpiActivityItem {
                    Type = hm.Groups[1].Value, Amount = amount,
                    Timestamp = instant.ToOffset(TimeSpan.FromMinutes(330)).DateTime,
                    CounterPartyName = CounterpartyRegex.Match(remainder) is var cp && cp.Success ? cp.Groups[1].Value.Trim() : null,
                    AccountSuffix = AccountSuffixRegex.Match(remainder) is var acc && acc.Success ? acc.Groups[1].Value : null,
                    RefId = values.FirstOrDefault(v => !string.IsNullOrEmpty(v) && !states.Contains(v)),
                    Status = values.FirstOrDefault(v => states.Contains(v)) ?? "Unknown"
                });
            }
            return results;
        }

        public static List<List<string>> ParseCsv(string csv)
        {
            var rows = new List<List<string>>(); var row = new List<string>();
            var field = new System.Text.StringBuilder(); var quoted = false;
            for (int i = 0; i < csv.Length; i++) {
                var c = csv[i];
                if (c == '"') { if (quoted && i + 1 < csv.Length && csv[i + 1] == '"') { field.Append('"'); i++; } else quoted = !quoted; }
                else if (c == ',' && !quoted) { row.Add(field.ToString()); field.Clear(); }
                else if (c == '\n' && !quoted) { row.Add(field.ToString().TrimEnd('\r')); if (row.Any(v => v.Length > 0)) rows.Add(row); row = new(); field.Clear(); }
                else field.Append(c);
            }
            if (quoted) throw new FormatException("Unclosed CSV quoted field.");
            if (field.Length > 0 || row.Count > 0) { row.Add(field.ToString().TrimEnd('\r')); rows.Add(row); }
            return rows;
        }

        public static List<GPayCashbackItem> ParseCashbackCsv(string csv)
        {
            var results = new List<GPayCashbackItem>();
            foreach (var p in ParseCsv(csv ?? "").Skip(1)) {
                if (p.Count < 4 || p[1] != "INR" || !decimal.TryParse(p[2], NumberStyles.Any, CultureInfo.InvariantCulture, out var amount) ||
                    !DateTimeOffset.TryParse(p[0], CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var date)) continue;
                results.Add(new() { Date = date.ToOffset(TimeSpan.FromMinutes(330)).DateTime, Currency = p[1], Amount = amount, Description = p[3] });
            }
            return results;
        }

        public static List<GPayOrderTransactionItem> ParseTransactionsCsv(string csv)
        {
            var results = new List<GPayOrderTransactionItem>();
            foreach (var p in ParseCsv(csv ?? "").Skip(1)) {
                if (p.Count < 7 || !p[6].Contains("INR", StringComparison.OrdinalIgnoreCase) || !decimal.TryParse(CleanNumberRegex.Replace(p[6], ""), NumberStyles.Any, CultureInfo.InvariantCulture, out var amount) ||
                    !DateTime.TryParse(p[0].Replace("Sept ", "Sep "), CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)) continue;
                results.Add(new() { Time = date, TransactionId = p[1], Description = p[2], Product = p[3], PaymentMethod = p[4], Status = p[5], Amount = amount });
            }
            return results;
        }

        public static List<GPayVoucherItem> ParseVouchersJson(string json)
        {
            var results = new List<GPayVoucherItem>();
            if (string.IsNullOrWhiteSpace(json)) return results;

            var trimmed = json.Trim();
            var braceIdx = trimmed.IndexOf('{');
            if (braceIdx >= 0)
            {
                trimmed = trimmed.Substring(braceIdx);
            }

            try
            {
                using var doc = JsonDocument.Parse(trimmed);
                if (doc.RootElement.TryGetProperty("couponRewardExportRecord", out var arr) && arr.ValueKind == JsonValueKind.Array)
                {
                    foreach (var elem in arr.EnumerateArray())
                    {
                        var code = elem.TryGetProperty("code", out var c) ? c.GetString() ?? "" : "";
                        var details = elem.TryGetProperty("details", out var d) ? d.GetString() ?? "" : "";
                        var summary = elem.TryGetProperty("summary", out var s) ? s.GetString() ?? "" : "";
                        DateTime? expiry = null;
                        if (elem.TryGetProperty("expiryTimestamp", out var exp) && exp.GetString() is { } expStr)
                        {
                            if (DateTime.TryParse(expStr, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal, out var expDt))
                            {
                                expiry = expDt;
                            }
                        }

                        results.Add(new GPayVoucherItem
                        {
                            Code = code,
                            Details = details,
                            Summary = summary,
                            ExpiryTimestamp = expiry
                        });
                    }
                }
            }
            catch (JsonException ex) { throw new FormatException("Invalid voucher JSON.", ex); }

            return results;
        }

        private static List<string> ParseCsvLine(string line)
        {
            var result = new List<string>();
            bool inQuotes = false;
            var current = new System.Text.StringBuilder();

            for (int i = 0; i < line.Length; i++)
            {
                char c = line[i];
                if (c == '"')
                {
                    inQuotes = !inQuotes;
                }
                else if (c == ',' && !inQuotes)
                {
                    result.Add(current.ToString().Trim());
                    current.Clear();
                }
                else
                {
                    current.Append(c);
                }
            }
            result.Add(current.ToString().Trim());
            return result;
        }
    }
}
