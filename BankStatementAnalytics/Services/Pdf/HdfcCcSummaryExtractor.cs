using System.Globalization;
using System.Text.RegularExpressions;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Services.Pdf
{
    /// <summary>
    /// Best-effort extraction of the summary block of an HDFC credit card
    /// e-statement (statement date, billing period, total/minimum due, due date,
    /// credit limits, reward points balance). Works on the whole-document visual
    /// rows from <see cref="PdfStatementReader.DumpVisualRows"/> — the summary is
    /// a boxed panel, not part of the transaction table, so the table profile
    /// never sees it.
    ///
    /// Layout measured from a real Jun-2026 billed e-statement (the rupee glyph
    /// extracts as "C", amounts use Indian digit grouping):
    ///   Statement Date 23 Jun, 2026
    ///   Billing Period 24 May, 2026 - 23 Jun, 2026
    ///   PREVIOUS STATEMENT DUES FINANCE CHARGES TOTAL AMOUNT DUE
    ///   C18,800.00 C18,800.00 + C763.00 + C0.00 = C763.00
    ///   TOTAL CREDIT LIMIT
    ///   AVAILABLE CREDIT LIMIT AVAILABLE CASH LIMIT MINIMUM DUE DUE DATE
    ///   C200.00 13 Jul, 2026
    ///   C1,00,000 C99,237 C0
    ///   ... Reward Points ... / 0 210 0 0 / 210
    ///
    /// Every field is optional: a wording/layout change degrades to nulls (the
    /// UI falls back to manually-entered values), never to a failed upload.
    /// </summary>
    public static class HdfcCcSummaryExtractor
    {
        // "23 Jun, 2026" / "23 June 2026"
        private const string DatePart = @"\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{4}";

        // "C18,800.00" / "₹1,00,000" / "1,00,000" — the rupee glyph usually
        // extracts as a stray "C", sometimes survives as "₹" or is dropped.
        private const string AmountPart = @"(?:[C₹]\s?)?([\d,]+(?:\.\d{1,2})?)";

        private static readonly Regex StatementDateRegex =
            new($@"Statement Date\s+({DatePart})", RegexOptions.Compiled | RegexOptions.IgnoreCase);

        private static readonly Regex BillingPeriodRegex =
            new($@"Billing Period\s+({DatePart})\s*-\s*({DatePart})", RegexOptions.Compiled | RegexOptions.IgnoreCase);

        // The total-due box renders as an equation; the value is the amount after "=".
        private static readonly Regex TotalDueRegex =
            new($@"=\s*{AmountPart}\s*$", RegexOptions.Compiled);

        // "C200.00 13 Jul, 2026" — minimum due and due date share a row.
        private static readonly Regex MinDueDateRegex =
            new($@"^{AmountPart}\s+({DatePart})\s*$", RegexOptions.Compiled);

        // A row of nothing but currency amounts ("C1,00,000 C99,237 C0"):
        // total / available / cash limits. The C prefix is required so plain
        // integer rows (reward-point counters) can't match.
        private static readonly Regex LimitsRowRegex =
            new(@"^(?:[C₹]\s?[\d,]+(?:\.\d{1,2})?)(?:\s+[C₹]\s?[\d,]+(?:\.\d{1,2})?)+$", RegexOptions.Compiled);

        private static readonly Regex AmountTokenRegex =
            new(@"[C₹]\s?([\d,]+(?:\.\d{1,2})?)", RegexOptions.Compiled);

        private static readonly Regex FourIntsRegex = new(@"^\d+\s+\d+\s+\d+\s+\d+$", RegexOptions.Compiled);
        private static readonly Regex LoneIntRegex = new(@"^\d+$", RegexOptions.Compiled);

        private static readonly string[] DateFormats =
            { "d MMM, yyyy", "d MMM yyyy", "d MMMM, yyyy", "d MMMM yyyy" };

        public static CardStatementSummary Extract(PdfStatementReader reader, byte[] pdfBytes, string? password)
        {
            var lines = reader.DumpVisualRows(pdfBytes, password)
                .Where(l => !l.StartsWith('─')) // page markers
                .ToList();

            var summary = new CardStatementSummary();

            for (int i = 0; i < lines.Count; i++)
            {
                var line = lines[i];

                if (summary.StatementDate == null)
                {
                    var m = StatementDateRegex.Match(line);
                    if (m.Success) summary.StatementDate = ParseDate(m.Groups[1].Value);
                }

                if (summary.PeriodStart == null)
                {
                    var m = BillingPeriodRegex.Match(line);
                    if (m.Success)
                    {
                        summary.PeriodStart = ParseDate(m.Groups[1].Value);
                        summary.PeriodEnd = ParseDate(m.Groups[2].Value);
                    }
                }

                if (summary.TotalDue == null &&
                    line.Contains("TOTAL AMOUNT DUE", StringComparison.OrdinalIgnoreCase))
                {
                    summary.TotalDue = FindWithin(lines, i + 1, 6,
                        l => TotalDueRegex.Match(l) is { Success: true } tm ? ParseAmount(tm.Groups[1].Value) : null);
                }

                if (summary.MinimumDue == null &&
                    line.Contains("MINIMUM DUE", StringComparison.OrdinalIgnoreCase) &&
                    line.Contains("DUE DATE", StringComparison.OrdinalIgnoreCase))
                {
                    for (int j = i + 1; j < Math.Min(i + 6, lines.Count); j++)
                    {
                        var m = MinDueDateRegex.Match(lines[j]);
                        if (!m.Success) continue;
                        summary.MinimumDue = ParseAmount(m.Groups[1].Value);
                        summary.PaymentDueDate = ParseDate(m.Groups[2].Value);
                        break;
                    }
                }

                if (summary.CreditLimit == null &&
                    line.Contains("TOTAL CREDIT LIMIT", StringComparison.OrdinalIgnoreCase))
                {
                    for (int j = i + 1; j < Math.Min(i + 7, lines.Count); j++)
                    {
                        if (!LimitsRowRegex.IsMatch(lines[j])) continue;
                        var amounts = AmountTokenRegex.Matches(lines[j])
                            .Select(m => ParseAmount(m.Groups[1].Value))
                            .ToList();
                        if (amounts.Count >= 2)
                        {
                            summary.CreditLimit = amounts[0];
                            summary.AvailableCreditLimit = amounts[1];
                        }
                        break;
                    }
                }

                // Reward points table: a row of four counters (opening / earned /
                // disbursed / lapsed) followed by the lone closing-balance number.
                if (summary.RewardPointsBalance == null &&
                    line.Contains("Reward Points", StringComparison.OrdinalIgnoreCase))
                {
                    for (int j = i + 1; j < Math.Min(i + 8, lines.Count) - 1; j++)
                    {
                        if (!FourIntsRegex.IsMatch(lines[j])) continue;
                        if (LoneIntRegex.IsMatch(lines[j + 1]) &&
                            int.TryParse(lines[j + 1], out var balance))
                            summary.RewardPointsBalance = balance;
                        break;
                    }
                }
            }

            return summary;
        }

        private static T? FindWithin<T>(List<string> lines, int start, int count, Func<string, T?> probe)
            where T : struct
        {
            for (int i = start; i < Math.Min(start + count, lines.Count); i++)
            {
                var value = probe(lines[i]);
                if (value != null) return value;
            }
            return null;
        }

        private static DateTime? ParseDate(string raw) =>
            DateTime.TryParseExact(raw.Trim(), DateFormats, CultureInfo.InvariantCulture,
                DateTimeStyles.None, out var d) ? d : null;

        private static decimal? ParseAmount(string raw) =>
            decimal.TryParse(raw.Replace(",", ""), NumberStyles.Number,
                CultureInfo.InvariantCulture, out var v) ? v : null;
    }
}
