using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using BankStatementAnalytics.Models;
using Common.Framework.Logging;

namespace BankStatementAnalytics.Services.Parser
{
    public class OpTransactionParser : IBankParser
    {
        // Column threshold that separates Debit from Credit
        // Verified against all 147 transactions in the real statement:
        // Debit  : absolute char column < 150
        // Credit : absolute char column >= 150
        // Balance: always the LAST amount on the TRF line
        private const int CreditColumnThreshold = 150;

        // Lines that should be ignored completely
        private static readonly Regex[] SkipPatterns =
        {
            new(@"^\s*$"),
            new(@"Date.*Value Date"),
            new(@"Balance.*Debit"),
            new(@"Statement for the period"),
            new(@"Account Number|Customer Name|Customer ID"),
            new(@"A/C Open|Currency|MICR Code|A/C Type|A/C Status"),
            new(@"Address\s*:|Branch Name|Branch Address|Email\s*:|IFSC|Customer ID"),
            new(@"Balance in Liqui"),
            new(@"Total:"),
            new(@"Disclaimer"),
        };

        // Keywords that identify a remarks line
        private static readonly Regex KeywordRegex =
            new(@"UPI/|CASH|NEFT|ECOM|CHRGS|Int\.Pd", RegexOptions.Compiled);

        // Amount pattern (handles Indian lakh format: 1,80,000.00)
        private static readonly Regex AmountRegex =
            new(@"[\d,]+\.\d{2}", RegexOptions.Compiled);

        // Date pattern
        private static readonly Regex DateRegex =
            new(@"\d{2}/\d{2}/\d{4}", RegexOptions.Compiled);

        // Whitespace collapser for cleaning descriptions
        private static readonly Regex MultiSpaceRegex =
            new(@"\s{2,}", RegexOptions.Compiled);

        // Injected service
        private readonly CounterPartyService _counterPartyService;

        public OpTransactionParser(CounterPartyService counterPartyService)
        {
            _counterPartyService = counterPartyService;
        }

        // ────────────────────────────────────────────────────────────────────
        // MAIN PARSE LOOP
        // ────────────────────────────────────────────────────────────────────
        private IEnumerable<BankTransaction> Parse(string text, int accountId)
        {
            var transactions = new List<BankTransaction>();
            try
            {
                var lines = text.Replace("\r", "").Split('\n');

                string? pendingRemarks = null;
                (string tx, string val)? pendingDates = null;

                foreach (var rawLine in lines)
                {
                    try
                    {
                        string line = rawLine.TrimEnd();

                        if (ShouldSkip(line)) continue;

                        bool hasDate = DateRegex.IsMatch(line);
                        bool hasTrf = line.Contains("TRF");
                        bool hasKeyword = KeywordRegex.IsMatch(line);

                        if (hasKeyword && !hasDate && !hasTrf)
                        {
                            pendingRemarks = line.Trim();
                            continue;
                        }

                        // ── (2) TRF / amounts line ───────────────────────────────────
                        if (hasTrf)
                        {
                            string txDate, valDate;

                            if (hasDate)
                            {
                                var dates = DateRegex.Matches(line);
                                txDate = dates[0].Value;
                                valDate = dates.Count > 1 ? dates[1].Value : dates[0].Value;
                                pendingDates = null;
                            }
                            else if (pendingDates.HasValue)
                            {
                                (txDate, valDate) = pendingDates.Value;
                                pendingDates = null;
                            }
                            else
                            {
                                // No dates available — orphan TRF line, skip
                                pendingRemarks = null;
                                continue;
                            }

                            // Resolve remarks:
                            // CASH rows have keyword + date + TRF all on one line,
                            // so the line itself is used when no pending remarks exist.
                            string remarks = hasKeyword
                                ? line.Trim()
                                : (pendingRemarks ?? string.Empty);

                            pendingRemarks = null;

                            var tx = BuildTransaction(txDate, valDate, line, remarks, accountId);
                            if (tx != null)
                                transactions.Add(tx);

                            continue;
                        }

                        // ── (3) Date-only line (no TRF yet) ─────────────────────────
                        if (hasDate)
                        {
                            var dates = DateRegex.Matches(line);
                            pendingDates = (
                                dates[0].Value,
                                dates.Count > 1 ? dates[1].Value : dates[0].Value
                            );

                            // Remarks may be embedded on the same line as the date
                            // e.g. "01/06/2026  01/06/2026  UPI/124010099773/CR/..."
                            if (hasKeyword)
                                pendingRemarks = line.Trim();
                        }
                    }
                    catch (Exception ex)
                    {
                        Log.Error($"IOB Parse Error on line: {rawLine}", ex);
                    }
                }
            }
            catch (Exception ex)
            {
                Log.Error($"Fatal error parsing IOB statement for account {accountId}", ex);
            }

            return transactions;
        }

        // ────────────────────────────────────────────────────────────────────
        // BUILD SINGLE TRANSACTION
        // ────────────────────────────────────────────────────────────────────
        private BankTransaction? BuildTransaction(
            string txDate, string valDate,
            string trfLine, string remarks,
            int accountId)
        {
            string description = CleanDescription(remarks, trfLine);

            var tx = new BankTransaction
            {
                ImportedOn = DateTime.Now,
                Description = description,
                AccountId = accountId,
                BankType = "IOB",
                TransactionDate = DateTime.ParseExact(txDate, "dd/MM/yyyy", CultureInfo.InvariantCulture),
                ValueDate = DateTime.ParseExact(valDate, "dd/MM/yyyy", CultureInfo.InvariantCulture),
            };

            // Order matters: GenerateReference depends on output of both
            ParseAmounts(trfLine, tx);
            ParseRemarks(remarks, tx, out string? counterPartyName);
            tx.BankReference = GenerateReference(tx);

            // Resolve CounterParty from master table using name + bankcode
            // (single call — IOB text format has no VPA)
            if (!string.IsNullOrWhiteSpace(counterPartyName))
                tx.CounterParty = _counterPartyService.ResolveOrCreate(
                    counterPartyName,
                    tx.BankCode,
                    upiId: null);

            return tx;
        }

        // ────────────────────────────────────────────────────────────────────
        // CLEAN DESCRIPTION
        // ────────────────────────────────────────────────────────────────────
        /// <summary>
        /// Collapses fixed-width whitespace padding and avoids duplicating
        /// the line content when remarks and trfLine are the same (e.g. CASH).
        /// </summary>
        private static string CleanDescription(string remarks, string trfLine)
        {
            var cleanTrf = MultiSpaceRegex.Replace(trfLine.Trim(), " ");
            var cleanRemarks = MultiSpaceRegex.Replace(remarks.Trim(), " ");

            // Single-line rows (CASH): remarks == trfLine, avoid duplication
            return string.IsNullOrWhiteSpace(cleanRemarks) || cleanRemarks == cleanTrf
                ? cleanTrf
                : $"{cleanRemarks} | {cleanTrf}";
        }

        // ────────────────────────────────────────────────────────────────────
        // PARSE AMOUNTS
        // ────────────────────────────────────────────────────────────────────
        /// <summary>
        /// Extracts debit, credit, and balance from the TRF line using
        /// absolute character column position to distinguish debit vs credit.
        /// Debit  : col &lt; 150
        /// Credit : col &gt;= 150
        /// Balance: always the last amount on the line
        /// </summary>
        private static void ParseAmounts(string trfLine, BankTransaction tx)
        {
            if (!trfLine.Contains("TRF")) return;

            var nums = AmountRegex.Matches(trfLine)
                .Cast<Match>()
                .Select(m => (col: m.Index, value: decimal.Parse(
                    m.Value.Replace(",", ""), CultureInfo.InvariantCulture)))
                .ToList();

            if (nums.Count == 0) return;

            // Balance is always the rightmost (last) amount
            tx.Balance = nums[^1].value;

            if (nums.Count < 2) return;

            // The single non-balance amount is second to last
            var (col, amount) = nums[^2];

            tx.Amount = amount;

            if (col < CreditColumnThreshold)
            {
                tx.Debit = amount;
                tx.Credit = 0;
                tx.TransactionType = "DR";
            }
            else
            {
                tx.Credit = amount;
                tx.Debit = 0;
                tx.TransactionType = "CR";
            }
        }

        // ────────────────────────────────────────────────────────────────────
        // PARSE REMARKS
        // ────────────────────────────────────────────────────────────────────
        /// <summary>
        /// Populates Mode, UpiReference, BankCode, TransactionType.
        /// CounterParty name is returned via out param so the caller can
        /// resolve it against the CounterParties master table.
        /// </summary>
        private static void ParseRemarks(string remarks, BankTransaction tx, out string? counterPartyName)
        {
            counterPartyName = null;

            if (string.IsNullOrWhiteSpace(remarks)) return;

            if (remarks.Contains("UPI/"))
            {
                tx.Mode = "UPI";

                var m = Regex.Match(remarks,
                    @"UPI/(\d+)/(CR|DR)/\s*([^/]+?)\s*/([A-Za-z]+)(?:/|$|\s)");

                if (m.Success)
                {
                    tx.UpiReference = m.Groups[1].Value;
                    tx.TransactionType = m.Groups[2].Value;         // overrides column detection
                    counterPartyName = m.Groups[3].Value.Trim();
                    tx.BankCode = m.Groups[4].Value.ToUpper();
                }
            }
            else if (remarks.Contains("CASH"))
            {
                tx.Mode = "CASH";
                tx.TransactionType = "DR";
                counterPartyName = "CASH";
            }
            else if (remarks.Contains("NEFT"))
            {
                tx.Mode = "NEFT";
                var m = Regex.Match(remarks, @"NEFT-\w+-\w+-([^-\n]+)-");
                counterPartyName = m.Success ? m.Groups[1].Value.Trim() : "NEFT";
            }
            else if (remarks.Contains("ECOM"))
            {
                tx.Mode = "ECOM";
                var m = Regex.Match(remarks, @"ECOM-([A-Z]+)");
                counterPartyName = m.Success ? m.Groups[1].Value.Trim() : "ECOM";
            }
            else if (remarks.Contains("CHRGS"))
            {
                tx.Mode = "INTERNAL";
                tx.TransactionType = "DR";
                counterPartyName = "IOB CHARGES";
            }
            else if (remarks.Contains("Int.Pd"))
            {
                tx.Mode = "INTERNAL";
                tx.TransactionType = "CR";
                counterPartyName = "IOB INTEREST";
            }
            else
            {
                tx.Mode = "OTHER";
            }
        }

        // ────────────────────────────────────────────────────────────────────
        // GENERATE REFERENCE
        // ────────────────────────────────────────────────────────────────────
        /// <summary>
        /// UPI  → "UPI" + 12-digit NPCI reference  (e.g. UPI615403947145)
        /// Other→ "GEN" + first 12 chars of SHA1 hash of key fields
        ///        (deterministic: re-importing same file won't create duplicates)
        /// </summary>
        private static string GenerateReference(BankTransaction tx)
        {
            if (!string.IsNullOrWhiteSpace(tx.UpiReference))
                return $"UPI{tx.UpiReference}";

            var raw = $"{tx.AccountId}|{tx.BankType}|{tx.TransactionDate:yyyyMMdd}|{tx.Mode}|{tx.Amount}|{tx.Balance}";
            var hash = Convert.ToHexString(
                SHA1.HashData(Encoding.UTF8.GetBytes(raw)))[..12];

            return $"GEN{hash}";
        }

        // ────────────────────────────────────────────────────────────────────
        // HELPERS
        // ────────────────────────────────────────────────────────────────────
        private static bool ShouldSkip(string line)
        {
            foreach (var pattern in SkipPatterns)
                if (pattern.IsMatch(line)) return true;
            return false;
        }

        // ── IBankParser explicit implementation ───────────────────────────────
        IEnumerable<BaseTransaction> IBankParser.Parse(string text, int accountId)
            => Parse(text, accountId);
    }
}