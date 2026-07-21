using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using BankStatementAnalytics.EnumClass;
using BankStatementAnalytics.Models;
using Common.Framework.Logging;

namespace BankStatementAnalytics.Services.Parser
{
    public class HdfcCreditCardParser : IBankParser
    {
        // Pure parser: records the counterparty NAME; the import pipeline batch-resolves merchants.

        private static readonly Regex UpiRegex =
            new(@"^UPI-(.+?)-([^-@]+@[^-]+)-([A-Z0-9]{11})-(\d+)-(.*)$",
                RegexOptions.Compiled | RegexOptions.IgnoreCase);

        private static readonly Regex AtmRegex =
            new(@"^(NWD|ATW)-(.+?)-(.+?)-(.+)$",
                RegexOptions.Compiled | RegexOptions.IgnoreCase);

        private static readonly Regex EmiFtRegex =
            new(@"^(EMI|FT)-\s*(.+?)-(\d+)\s*-\s*(.+?)\s*-\s*$",
                RegexOptions.Compiled | RegexOptions.IgnoreCase);

        // ── IBankParser explicit implementation ───────────────────────────
        IEnumerable<BankTransaction> IBankParser.Parse(string text, int accountId)
            => Parse(text, accountId);

        // ── Public entry point ────────────────────────────────────────────
        public IEnumerable<BankTransaction> Parse(string text, int accountId)
        {
            var transactions = new List<BankTransaction>();

            try
            {
                var lines = text
                    .Replace("\r", "")
                    .Split('\n')
                    .Select(l => l.Trim())
                    .Where(l => !string.IsNullOrWhiteSpace(l))
                    .ToList();

                bool inTxSection = false;

                foreach (var line in lines)
                {
                    try
                    {
                        // Detect transaction header row
                        if (line.StartsWith("Transaction type~|~",
                            StringComparison.OrdinalIgnoreCase))
                        {
                            inTxSection = true;
                            continue;
                        }

                        if (!inTxSection) continue;

                        // Stop at footer
                        if (line.StartsWith("State account", StringComparison.OrdinalIgnoreCase) ||
                            line.StartsWith("HSN Code", StringComparison.OrdinalIgnoreCase) ||
                            line.StartsWith("Registered", StringComparison.OrdinalIgnoreCase))
                            break;

                        var cols = line.Split("~|~", StringSplitOptions.None);
                        if (cols.Length < 5) continue;

                        var tx = BuildTransaction(cols, accountId);
                        if (tx != null)
                            transactions.Add(tx);
                    }
                    catch (Exception ex)
                    {
                        Log.Error($"HDFC CC Parse Error on line: {line}", ex);
                    }
                }
            }
            catch (Exception ex)
            {
                Log.Error($"Fatal error parsing HDFC CC statement for account {accountId}", ex);
            }

            AssignGeneratedReferences(transactions);
            return transactions;
        }

        // ── Build one transaction ─────────────────────────────────────────
        private BankTransaction? BuildTransaction(string[] cols, int accountId)
        {
            // Layout: txType | custName | date | description | amount | [debitCredit] | [rewards]
            var txType = cols[0].Trim(); // "Domestic" / "International"
            var custName = cols[1].Trim();
            var dateRaw = cols[2].Trim(); // "23/05/2026 13:36:57"
            var desc = cols[3].Trim();
            var amtRaw = cols[4].Trim();
            var drCr = cols.Length > 5 ? cols[5].Trim() : string.Empty;

            if (!TryParseDateTime(dateRaw, out var txDate)) return null;

            decimal amount = ParseAmount(amtRaw);
            if (amount <= 0) return null;

            // For credit cards: no flag = purchase (debit), "Cr" = payment/refund (credit)
            bool isCredit = drCr.Equals("Cr", StringComparison.OrdinalIgnoreCase);

            var tx = new BankTransaction
            {
                AccountId = accountId,
                BankType = BankTypeCode.For(Bank.HDFCCreditCard),
                BankReference = string.Empty, // filled below
                TransactionDate = txDate,
                ValueDate = txDate,
                TransactionType = isCredit ? "CR" : "DR",
                Description = desc,
                Narration = $"{custName} | {txType}",
                Amount = amount,
                Debit = isCredit ? 0 : amount,
                Credit = isCredit ? amount : 0,
                Balance = 0, // CC statements have no per-row running balance
                ImportedOn = DateTime.Now,
            };

            // Parse description for mode, counterparty, UPI ref etc.
            ParseNarration(desc, tx, out string? counterPartyName);

            // Bill payments are the user's own money arriving from their bank
            // account — mark TRANSFER (analytics exclude these from income/spend).
            if (isCredit && desc.Contains("CREDIT CARD PAYMENT", StringComparison.OrdinalIgnoreCase))
            {
                tx.Mode = "TRANSFER";
                counterPartyName = "CREDIT CARD PAYMENT";
            }

            // Record CounterParty name for batch resolution after parsing.
            if (!string.IsNullOrWhiteSpace(counterPartyName))
                tx.PendingCounterPartyName = counterPartyName;

            // Rows without a real UPI reference get a generated one in the
            // AssignGeneratedReferences post-pass (needs whole-statement order).
            tx.BankReference = string.IsNullOrWhiteSpace(tx.UpiReference)
                ? string.Empty
                : $"HDFCCC{tx.UpiReference}";

            return tx;
        }

        // ── Narration parser ──────────────────────────────────────────────
        // internal: also reused by HdfcCreditCardPdfParser.
        internal static void ParseNarration(
            string narration,
            BankTransaction tx,
            out string? counterPartyName)
        {
            counterPartyName = null;

            if (string.IsNullOrWhiteSpace(narration)) return;

            // UPI
            if (narration.StartsWith("UPI-", StringComparison.OrdinalIgnoreCase))
            {
                tx.Mode = "UPI";
                var parts = narration.Split('-');

                int refIdx = -1;
                for (int i = 0; i < parts.Length; i++)
                {
                    if (Regex.IsMatch(parts[i].Trim(), @"^\d{12,}$"))
                    {
                        refIdx = i;
                        break;
                    }
                }

                string? vpa = parts.FirstOrDefault(p => p.Contains('@'))?.Trim();
                tx.UpiVpa = vpa;

                if (refIdx > 0)
                {
                    tx.UpiReference = parts[refIdx].Trim();
                    tx.BankCode = refIdx >= 2 ? parts[refIdx - 1].Trim().ToUpper() : null;

                    int vpaIdx = vpa != null
                        ? Array.IndexOf(parts, parts.First(p => p.Contains('@')))
                        : refIdx - 1;

                    counterPartyName = string.Join("-", parts.Skip(1).Take(vpaIdx - 1)).Trim();
                }
                else
                {
                    counterPartyName = parts.Length > 1 ? parts[1].Trim() : null;
                }

                return;
            }

            // ATM Withdrawal (NWD / ATW)
            if (narration.StartsWith("NWD-", StringComparison.OrdinalIgnoreCase) ||
                narration.StartsWith("ATW-", StringComparison.OrdinalIgnoreCase))
            {
                tx.Mode = "ATM";
                tx.TransactionType = "DR";
                var m = AtmRegex.Match(narration);
                counterPartyName = m.Success
                    ? $"ATM {m.Groups[4].Value.Trim()}"
                    : "ATM WITHDRAWAL";
                return;
            }

            // EMI
            if (narration.StartsWith("EMI", StringComparison.OrdinalIgnoreCase))
            {
                tx.Mode = "EMI";
                var m = EmiFtRegex.Match(narration);
                counterPartyName = m.Success
                    ? m.Groups[4].Value.Trim()
                    : narration.Split('-').Skip(1).FirstOrDefault()?.Trim() ?? "EMI";
                return;
            }

            // FT (Fund Transfer)
            if (narration.StartsWith("FT-", StringComparison.OrdinalIgnoreCase))
            {
                tx.Mode = "FT";
                var m = EmiFtRegex.Match(narration);
                counterPartyName = m.Success
                    ? m.Groups[4].Value.Trim()
                    : narration[3..].Trim();
                return;
            }

            // NEFT / RTGS / IMPS
            if (Regex.IsMatch(narration, @"^(NEFT|RTGS|IMPS)", RegexOptions.IgnoreCase))
            {
                tx.Mode = "NEFT";
                var parts = narration.Split('-');
                counterPartyName = parts.Length > 2 ? parts[2].Trim() : "NEFT";
                return;
            }

            // Fallback — use first segment as counterparty
            tx.Mode = "POS";
            counterPartyName = narration.Split('-').FirstOrDefault()?.Trim();
        }

        // ── Reference generator ───────────────────────────────────────────
        // internal: also reused by HdfcCreditCardPdfParser.
        //
        // CC statements carry no bank reference, so one is synthesized — and it
        // must come out IDENTICAL for the CSV export and the PDF e-statement of
        // the same bill, or importing both creates duplicate transactions. The
        // formats render the same row differently (CSV has seconds, PDF only
        // minutes; spacing inside descriptions differs), so the seed keeps only
        // what both agree on: date without time, fixed-format amount, and the
        // description stripped of all whitespace, uppercased.
        internal static string ReferenceSeed(BankTransaction tx) =>
            $"{tx.AccountId}|{tx.BankType}|{tx.TransactionDate:yyyyMMdd}" +
            $"|{tx.Amount.ToString("F2", CultureInfo.InvariantCulture)}" +
            $"|{SeedDescription(tx.Description)}";

        // The seed key for the description. Card/bill payments render differently
        // across formats — the CSV keeps a "Net Banking (Ref# …)" tail the PDF
        // drops — so collapse those to a canonical token keyed on date+amount only.
        // Other rows differ across formats by whitespace at most, so just strip it.
        private static string SeedDescription(string? description)
        {
            var desc = description ?? string.Empty;
            if (desc.Contains("CREDIT CARD PAYMENT", StringComparison.OrdinalIgnoreCase))
                return "CREDITCARDPAYMENT";
            return Regex.Replace(desc, @"\s+", "").ToUpperInvariant();
        }

        // Whole-statement post-pass: an occurrence counter (in statement order)
        // keeps two genuinely identical same-day purchases distinct, in a way
        // that still matches across formats because both list rows in order.
        internal static void AssignGeneratedReferences(List<BankTransaction> transactions)
        {
            var seen = new Dictionary<string, int>();
            foreach (var tx in transactions)
            {
                if (!string.IsNullOrEmpty(tx.BankReference)) continue; // real HDFCCC<upi-ref>

                var seed = ReferenceSeed(tx);
                seen[seed] = seen.TryGetValue(seed, out var n) ? n + 1 : 1;
                var hash = Convert.ToHexString(
                    SHA1.HashData(Encoding.UTF8.GetBytes($"{seed}#{seen[seed]}")))[..12];
                tx.BankReference = $"GEN{hash}";
            }
        }

        // ── Date helpers (same as HdfcTransactionParser) ──────────────────
        private static bool TryParseDateTime(string s, out DateTime dt)
        {
            string[] fmts = { "dd/MM/yyyy HH:mm:ss", "dd/MM/yyyy", "dd/MM/yy" };
            return DateTime.TryParseExact(
                s.Trim(), fmts,
                CultureInfo.InvariantCulture, DateTimeStyles.None, out dt);
        }

        // ── Amount helper (same as HdfcTransactionParser) ─────────────────
        private static decimal ParseAmount(string raw)
        {
            var clean = raw.Replace(",", "").Trim();
            return decimal.TryParse(clean, NumberStyles.Any,
                CultureInfo.InvariantCulture, out decimal val) ? val : 0;
        }
    }
}