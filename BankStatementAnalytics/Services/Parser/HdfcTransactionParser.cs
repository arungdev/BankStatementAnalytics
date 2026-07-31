using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using BankStatementAnalytics.EnumClass;
using BankStatementAnalytics.Models;
using Common.Framework.Logging;

namespace BankStatementAnalytics.Services.Parser
{
    public class HdfcTransactionParser : IBankParser
    {
        // Parsers are pure: they extract the counterparty NAME onto the transaction
        // (PendingCounterPartyName); the import pipeline resolves it to a Merchant in one batch.

        // ── Compiled regexes ─────────────────────────────────────────

        private static readonly Regex DateRegex =
            new(@"\d{2}/\d{2}/\d{2,4}", RegexOptions.Compiled);

        private static readonly Regex NeftRegex =
            new(@"^NEFT\s+(CR|DR)-([A-Z0-9]+)-(.+?)-(.+?)-([A-Z0-9]+)$",
                RegexOptions.Compiled | RegexOptions.IgnoreCase);

        private static readonly Regex ImpsRegex =
            new(@"^IMPS-(\d+)-(.+?)-([A-Z0-9]+)-(.+?)-(.*)$",
                RegexOptions.Compiled | RegexOptions.IgnoreCase);

        private static readonly Regex FtRegex =
            new(@"^FT-\s*(.+?)-(\d+)\s*-\s*(.+?)\s*-\s*$",
                RegexOptions.Compiled | RegexOptions.IgnoreCase);

        private static readonly Regex RdRegex =
            new(@"^(\d+)-\s*RD INSTALLMENT-(.+)$",
                RegexOptions.Compiled | RegexOptions.IgnoreCase);

        private static readonly Regex BillPayRegex =
            new(@"^IB BILLPAY (DR|CR)-(.+?)-(.+)$",
                RegexOptions.Compiled | RegexOptions.IgnoreCase);

        // Masked card number as the BillPay payee ("653029XXXXXX5216") — the
        // payment is a credit card bill; capture the last 4 for the label.
        private static readonly Regex MaskedCardRegex =
            new(@"^\d{4,6}X{4,}(\d{4})$",
                RegexOptions.Compiled | RegexOptions.IgnoreCase);

        private static readonly Regex FdRegex =
            new(@"^IB FD (.+?)-(\d+)$",
                RegexOptions.Compiled | RegexOptions.IgnoreCase);

        private static readonly Regex AtmRegex =
            new(@"^(NWD|ATW)-(.+?)-(.+?)-(.+)$",
                RegexOptions.Compiled | RegexOptions.IgnoreCase);

        // ── Fixed-width column layout (measured from actual HDFC output) ──
        //
        //  [0:10]   Date         "01/06/26  "
        //  [10:52]  Narration    42 chars, wrapped across continuation lines
        //  [52:68]  Ref No       16 chars
        //  [68:70]  gap
        //  [70:78]  Value Date   "01/06/26"
        //  [78:80]  gap
        //  [80:98]  Withdrawal   18 chars, right-aligned
        //  [98:117] Deposit      19 chars, right-aligned
        //  [117:]   Balance      remainder, right-aligned
        //
        // Continuation lines: narration text in [10:52], everything from col 52
        // onward is blank — this is the reliable way to tell them apart from
        // header/footer noise, which always has content beyond col 52.

        private const int ColNarrationStart = 10;
        private const int ColNarrationEnd = 52;
        private const int ColRefStart = 52;
        private const int ColRefEnd = 68;
        private const int ColValueDateStart = 70;
        private const int ColValueDateEnd = 78;
        private const int ColWithdrawalStart = 80;
        private const int ColWithdrawalEnd = 98;
        private const int ColDepositStart = 98;
        private const int ColDepositEnd = 117;
        private const int ColBalanceStart = 117;

        // ── Entry point ──────────────────────────────────────────────

        private IEnumerable<BankTransaction> Parse(string text, int accountId)
        {
            var transactions = new List<BankTransaction>();
            try
            {
                if (DetectCsvFormat(text))
                    transactions.AddRange(ParseCsv(text, accountId));
                else
                    transactions.AddRange(ParseFixedWidth(text, accountId));
            }
            catch (Exception ex)
            {
                Log.Error($"Fatal error parsing HDFC statement for account {accountId}", ex);
            }
            return transactions;
        }

        // ── Format detection ─────────────────────────────────────────

        /// <summary>
        /// CSV export has a comma-delimited header row starting with "Date".
        /// Fixed-width print format has the same header but without commas.
        /// </summary>
        private static bool DetectCsvFormat(string text)
        {
            foreach (var line in text.Split('\n').Take(20))
            {
                string t = line.Trim();
                if (t.StartsWith("Date", StringComparison.OrdinalIgnoreCase))
                    return t.Contains(',');
            }
            // Fallback: any line with 7+ comma-separated fields and a leading date
            return text.Split('\n')
                .Any(l => DateRegex.IsMatch(l.TrimStart()) && l.Split(',').Length >= 7);
        }

        // ── CSV parser ───────────────────────────────────────────────

        private IEnumerable<BankTransaction> ParseCsv(string text, int accountId)
        {
            var transactions = new List<BankTransaction>();
            var lines = text.Replace("\r", "").Split('\n')
                .Select(l => l.Trim())
                .Where(l => !string.IsNullOrWhiteSpace(l));

            foreach (var line in lines)
            {
                try
                {
                    if (line.StartsWith("Date", StringComparison.OrdinalIgnoreCase))
                        continue;

                    var cols = SplitCsvHdfc(line);
                    if (cols.Length < 7) continue;
                    if (!DateRegex.IsMatch(cols[0].Trim())) continue;

                    var tx = BuildTransaction(cols, accountId);
                    if (tx != null) transactions.Add(tx);
                }
                catch (Exception ex)
                {
                    Log.Error($"HDFC CSV Parse Error on line: {line}", ex);
                }
            }
            return transactions;
        }

        // ── Fixed-width parser ───────────────────────────────────────

        private IEnumerable<BankTransaction> ParseFixedWidth(string text, int accountId)
        {
            var transactions = new List<BankTransaction>();
            var rawLines = text.Replace("\r", "").Split('\n').ToList();
            var logicalLines = ReconstructFixedWidthLines(rawLines);

            foreach (var logical in logicalLines)
            {
                try
                {
                    var tx = ParseFixedWidthLine(logical, accountId);
                    if (tx != null) transactions.Add(tx);
                }
                catch (Exception ex)
                {
                    Log.Error($"HDFC Fixed-Width Parse Error on line: {logical}", ex);
                }
            }
            return transactions;
        }

        /// <summary>
        /// Joins wrapped narration lines into single logical transaction lines.
        ///
        /// A data line starts with a date at col 0 (e.g. "01/06/26").
        /// A continuation line has narration text in [10:52] and is ENTIRELY
        /// BLANK from col 52 onward — this reliably distinguishes it from
        /// header/footer lines that have content across the full width.
        /// Everything else (separators, headers, footers) is discarded.
        /// </summary>
        private static List<string> ReconstructFixedWidthLines(List<string> rawLines)
        {
            var logical = new List<string>();
            string? current = null;

            foreach (var raw in rawLines)
            {
                // Separator lines
                string trimmed = raw.TrimStart();
                if (trimmed.StartsWith("---") || trimmed.StartsWith("***"))
                    continue;

                // Data line: starts with a date at column 0
                if (raw.Length >= 8 && DateRegex.IsMatch(raw[..8].TrimStart())
                    && char.IsDigit(raw.TrimStart()[0]))
                {
                    if (current != null)
                        logical.Add(current);
                    current = raw;
                    continue;
                }

                // Continuation line: only valid if we're inside a transaction
                // AND cols [52:] are entirely blank (true narration wrap).
                if (current != null && IsNarrationContinuation(raw))
                {
                    string chunk = raw.Length > ColNarrationEnd
                        ? raw[ColNarrationStart..ColNarrationEnd].Trim()
                        : raw[Math.Min(ColNarrationStart, raw.Length)..].Trim();

                    if (!string.IsNullOrWhiteSpace(chunk))
                        current += "\x00" + chunk;

                    continue;
                }

                // Anything else (header, footer, blank lines) — discard.
                // If we reach here while mid-transaction, the transaction is
                // already complete; the next data line will flush it.
            }

            if (current != null)
                logical.Add(current);

            return logical;
        }

        /// <summary>
        /// Returns true if this line is a genuine narration continuation:
        /// it must be non-empty, have non-blank text in the narration column
        /// range [10:52], and be entirely blank from col 52 onward.
        /// </summary>
        private static bool IsNarrationContinuation(string line)
        {
            if (line.Length < ColNarrationStart + 1) return false;

            // Must have some non-blank narration content
            int end = Math.Min(line.Length, ColNarrationEnd);
            string narrationPart = line[ColNarrationStart..end];
            if (string.IsNullOrWhiteSpace(narrationPart)) return false;

            // Everything from col 52 onward must be blank
            if (line.Length > ColRefStart)
            {
                string rest = line[ColRefStart..];
                if (!string.IsNullOrWhiteSpace(rest)) return false;
            }

            return true;
        }

        /// <summary>
        /// Slices a reconstructed logical line into the 7-element cols[] array
        /// that BuildTransaction expects, using the measured column positions.
        /// </summary>
        private BankTransaction? ParseFixedWidthLine(string logical, int accountId)
        {
            // Split sentinel-joined narration continuations
            var parts = logical.Split('\x00');
            string firstLine = parts[0];

            if (firstLine.Length < ColNarrationEnd) return null;

            string dateRaw = firstLine[0..ColNarrationStart].Trim();
            if (!DateRegex.IsMatch(dateRaw)) return null;

            string narrationBase = firstLine[ColNarrationStart..ColNarrationEnd].Trim();
            string narrationFull = parts.Length > 1
                ? narrationBase + string.Join("", parts[1..])
                : narrationBase;

            string Slice(int start, int end) =>
                firstLine.Length >= end ? firstLine[start..end].Trim()
                : firstLine.Length > start ? firstLine[start..].Trim()
                : string.Empty;

            string refNo = Slice(ColRefStart, ColRefEnd);
            string valDateRaw = Slice(ColValueDateStart, ColValueDateEnd);
            string withdrawal = Slice(ColWithdrawalStart, ColWithdrawalEnd);
            string deposit = Slice(ColDepositStart, ColDepositEnd);
            string balance = firstLine.Length > ColBalanceStart
                                 ? firstLine[ColBalanceStart..].Trim()
                                 : string.Empty;

            // Same column order as the CSV parser:
            // [0] Date  [1] Narration  [2] Value Date
            // [3] Debit [4] Credit     [5] Ref No  [6] Closing Balance
            string[] cols = { dateRaw, narrationFull, valDateRaw,
                               withdrawal, deposit, refNo, balance };

            return BuildTransaction(cols, accountId);
        }

        // ── Shared transaction builder ────────────────────────────────
        // internal static: also reused by HdfcPdfParser (same 7-column layout).

        internal static BankTransaction? BuildTransaction(string[] cols, int accountId)
        {
            string dateRaw = cols[0].Trim();
            string narration = cols[1].Trim();
            string valDateRaw = cols[2].Trim();
            string debitRaw = cols[3].Trim();
            string creditRaw = cols[4].Trim();
            string refNo = cols[5].Trim();
            string balanceRaw = cols[6].Trim();

            var tx = new BankTransaction
            {
                ImportedOn = DateTime.Now,
                Description = narration,
                Narration = narration,
                AccountId = accountId,
                BankType = BankTypeCode.For(Bank.HDFC),
                BankReference = refNo.TrimStart('0'),
            };

            tx.TransactionDate = ParseDate(dateRaw);
            tx.ValueDate = string.IsNullOrWhiteSpace(valDateRaw)
                ? tx.TransactionDate
                : ParseDate(valDateRaw);

            decimal debit = ParseAmount(debitRaw);
            decimal credit = ParseAmount(creditRaw);
            decimal balance = ParseAmount(balanceRaw);

            tx.Balance = balance;

            if (debit > 0)
            {
                tx.Debit = debit;
                tx.Credit = 0;
                tx.Amount = debit;
                tx.TransactionType = "DR";
            }
            else if (credit > 0)
            {
                tx.Credit = credit;
                tx.Debit = 0;
                tx.Amount = credit;
                tx.TransactionType = "CR";
            }

            ParseNarration(narration, tx, out string? counterPartyName);

            if (!string.IsNullOrWhiteSpace(counterPartyName))
                tx.PendingCounterPartyName = counterPartyName;

            if (string.IsNullOrWhiteSpace(tx.BankReference) || tx.BankReference == "0")
                tx.BankReference = GenerateReference(tx);

            return tx;
        }

        // ── Narration parser ─────────────────────────────────────────

        private static void ParseNarration(
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
                    { refIdx = i; break; }
                }

                if (refIdx > 0)
                {
                    tx.UpiReference = parts[refIdx].Trim();
                    tx.BankCode = refIdx >= 2 ? parts[refIdx - 1].Trim().ToUpper() : null;

                    string? vpa = parts.FirstOrDefault(p => p.Contains('@'))?.Trim();
                    int vpaIdx = vpa != null
                        ? Array.IndexOf(parts, parts.First(p => p.Contains('@')))
                        : refIdx - 1;

                    counterPartyName = string.Join("-", parts.Skip(1).Take(vpaIdx - 1)).Trim();
                    tx.UpiVpa = vpa;

                    string remark = string.Join("-", parts.Skip(refIdx + 1)).Trim();
                    if (tx.TransactionType == null)
                        tx.TransactionType = remark.Contains("SEND",
                            StringComparison.OrdinalIgnoreCase) ? "DR" : "CR";
                }
                else
                {
                    counterPartyName = parts.Length > 1 ? parts[1].Trim() : null;
                    tx.UpiVpa = parts.FirstOrDefault(p => p.Contains('@'))?.Trim();
                }
                return;
            }

            // NEFT
            if (narration.StartsWith("NEFT", StringComparison.OrdinalIgnoreCase))
            {
                tx.Mode = "NEFT";
                var m = NeftRegex.Match(narration);
                if (m.Success)
                {
                    string direction = m.Groups[1].Value.ToUpper();
                    tx.BankCode = m.Groups[2].Value;
                    tx.UpiReference = m.Groups[5].Value.Trim();
                    // Group 3 is the OTHER party in both directions:
                    // CR: NEFT CR-<their ifsc>-<sender name>-<remark>-<ref>
                    // DR: NEFT DR-<their ifsc>-<beneficiary name>-<remark>-<ref>
                    counterPartyName = m.Groups[3].Value.Trim();
                    if (tx.TransactionType == null) tx.TransactionType = direction;
                }
                else counterPartyName = "NEFT";
                return;
            }

            // IMPS
            if (narration.StartsWith("IMPS", StringComparison.OrdinalIgnoreCase))
            {
                tx.Mode = "IMPS";
                var m = ImpsRegex.Match(narration);
                if (m.Success)
                {
                    tx.UpiReference = m.Groups[1].Value.Trim();
                    counterPartyName = m.Groups[2].Value.Trim();
                    tx.BankCode = m.Groups[3].Value.Trim().ToUpper();
                }
                else counterPartyName = "IMPS";
                return;
            }

            // FT (Fund Transfer / Salary)
            if (narration.StartsWith("FT-", StringComparison.OrdinalIgnoreCase))
            {
                tx.Mode = "FT";
                var m = FtRegex.Match(narration);
                counterPartyName = m.Success ? m.Groups[3].Value.Trim() : narration[3..].Trim();
                return;
            }

            // RD Installment
            if (narration.Contains("RD INSTALLMENT", StringComparison.OrdinalIgnoreCase))
            {
                tx.Mode = "INTERNAL";
                tx.TransactionType = "DR";
                var m = RdRegex.Match(narration);
                counterPartyName = m.Success
                    ? $"RD {m.Groups[2].Value.Trim()}"
                    : "RD INSTALLMENT";
                return;
            }

            // IB Bill Pay
            if (narration.StartsWith("IB BILLPAY", StringComparison.OrdinalIgnoreCase))
            {
                tx.Mode = "BILLPAY";
                var m = BillPayRegex.Match(narration);
                if (m.Success)
                {
                    if (tx.TransactionType == null) tx.TransactionType = m.Groups[1].Value.ToUpper();

                    // "IB BILLPAY DR-<biller code>-<payee>": a masked-card payee
                    // means a credit card bill — label it so, instead of showing
                    // the opaque biller code (HDFC5X etc.) as the merchant. It's
                    // money moving to the user's own card, so mark it TRANSFER;
                    // analytics exclude TRANSFER rows from income/spend.
                    var card = MaskedCardRegex.Match(m.Groups[3].Value.Trim());
                    if (card.Success)
                    {
                        tx.Mode = "TRANSFER";
                        counterPartyName = $"CREDIT CARD BILL {card.Groups[1].Value}";
                    }
                    else
                    {
                        counterPartyName = m.Groups[2].Value.Trim();
                    }
                }
                else counterPartyName = "BILL PAYMENT";
                return;
            }

            // IB FD (Fixed Deposit)
            if (narration.StartsWith("IB FD", StringComparison.OrdinalIgnoreCase))
            {
                tx.Mode = "FD";
                tx.TransactionType ??= "CR";
                var m = FdRegex.Match(narration);
                counterPartyName = m.Success
                    ? $"FD {m.Groups[1].Value.Trim()}"
                    : "FIXED DEPOSIT";
                return;
            }

            // ATM (NWD / ATW)
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

            // Fallback
            tx.Mode = "OTHER";
            counterPartyName = narration.Split('-').FirstOrDefault()?.Trim();
        }

        // ── Helpers ──────────────────────────────────────────────────

        private static string GenerateReference(BankTransaction tx)
        {
            if (!string.IsNullOrWhiteSpace(tx.UpiReference))
                return $"UPI{tx.UpiReference}";

            var raw = $"{tx.AccountId}|{tx.BankType}|{tx.TransactionDate:yyyyMMdd}|{tx.Mode}|{tx.Amount}|{tx.Balance}";
            var hash = Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(raw)))[..12];
            return $"GEN{hash}";
        }

        private static DateTime ParseDate(string raw)
        {
            if (DateTime.TryParseExact(raw, "dd/MM/yy",
                    CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt)) return dt;
            if (DateTime.TryParseExact(raw, "dd/MM/yyyy",
                    CultureInfo.InvariantCulture, DateTimeStyles.None, out dt)) return dt;
            throw new FormatException($"Cannot parse date: '{raw}'");
        }

        private static decimal ParseAmount(string raw)
        {
            var clean = raw.Replace(",", "").Trim();
            return decimal.TryParse(clean, NumberStyles.Any,
                CultureInfo.InvariantCulture, out decimal val) ? val : 0;
        }

        /// <summary>
        /// Splits a CSV line where the Narration column (index 1) may contain
        /// commas. Splits right-to-left: last 5 columns are always comma-safe.
        /// Layout: Date | Narration | ValueDate | Debit | Credit | Ref | Balance
        /// </summary>
        private static string[] SplitCsvHdfc(string line)
        {
            var all = line.Split(',');
            if (all.Length == 7) return all;
            if (all.Length < 7) return all; // malformed

            string narration = string.Join(",", all[1..(all.Length - 5)]);
            return new[]
            {
                all[0],
                narration,
                all[all.Length - 5],
                all[all.Length - 4],
                all[all.Length - 3],
                all[all.Length - 2],
                all[all.Length - 1],
            };
        }

        // ── IBankParser explicit implementation ───────────────────────
        IEnumerable<BankTransaction> IBankParser.Parse(string text, int accountId)
            => Parse(text, accountId);
    }
}