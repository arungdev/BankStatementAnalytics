using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using BankStatementAnalytics.Models;
using Common.Framework.Logging;

namespace BankStatementAnalytics.Services.Parser
{
    public class HdfcTransactionParser : IBankParser
    {
        private readonly CounterPartyService _counterPartyService;

        public HdfcTransactionParser(CounterPartyService counterPartyService)
        {
            _counterPartyService = counterPartyService;
        }

        private static readonly Regex DateRegex =
            new(@"\d{2}/\d{2}/\d{2,4}", RegexOptions.Compiled);

        private static readonly Regex AmountRegex =
            new(@"[\d,]+\.\d{2}", RegexOptions.Compiled);

        private static readonly Regex UpiRegex =
            new(@"^UPI-(.+?)-([^-@]+@[^-]+)-([A-Z0-9]{11})-(\d+)-(.*)$",
                RegexOptions.Compiled | RegexOptions.IgnoreCase);

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

        private static readonly Regex FdRegex =
            new(@"^IB FD (.+?)-(\d+)$",
                RegexOptions.Compiled | RegexOptions.IgnoreCase);

        private static readonly Regex AtmRegex =
            new(@"^(NWD|ATW)-(.+?)-(.+?)-(.+)$",
                RegexOptions.Compiled | RegexOptions.IgnoreCase);

        private IEnumerable<BankTransaction> Parse(string text, int accountId)
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

                foreach (var line in lines)
                {
                    try
                    {
                        if (line.StartsWith("Date") || line.StartsWith("Date ,"))
                            continue;

                        // All data rows are CSV — split on comma
                        var cols = SplitCsvHdfc(line);

                        // Need at least 7 columns:
                        // [0] Date  [1] Narration  [2] Value Date
                        // [3] Debit [4] Credit     [5] Ref No  [6] Closing Balance
                        if (cols.Length < 7) continue;

                        string dateRaw = cols[0].Trim();
                        if (!DateRegex.IsMatch(dateRaw)) continue;

                        var tx = BuildTransaction(cols, accountId);
                        if (tx != null)
                            transactions.Add(tx);
                    }
                    catch (Exception ex)
                    {
                        Log.Error($"HDFC Parse Error on line: {line}", ex);
                    }
                }
            }
            catch (Exception ex)
            {
                Log.Error($"Fatal error parsing HDFC statement for account {accountId}", ex);
            }

            return transactions;
        }

        private BankTransaction? BuildTransaction(string[] cols, int accountId)
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
                BankType = Bank.HDFC.ToString(),
                BankReference = refNo.TrimStart('0'), // strip leading zeros
            };

            // Dates
            tx.TransactionDate = ParseDate(dateRaw);
            tx.ValueDate = ParseDate(valDateRaw);

            // Amounts
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

            // Parse narration
            ParseNarration(narration, tx, out string? counterPartyName);

            // Resolve CounterParty (single call, with VPA)
            if (!string.IsNullOrWhiteSpace(counterPartyName))
                tx.CounterParty = _counterPartyService.ResolveOrCreate(
                    counterPartyName,
                    tx.BankCode,
                    upiId: tx.UpiVpa);

            // Generate reference if ref is empty/zeroed
            if (string.IsNullOrWhiteSpace(tx.BankReference) ||
                tx.BankReference == "0")
            {
                tx.BankReference = GenerateReference(tx);
            }

            return tx;
        }

        private static void ParseNarration(
            string narration,
            BankTransaction tx,
            out string? counterPartyName)
        {
            counterPartyName = null;

            if (string.IsNullOrWhiteSpace(narration)) return;

            if (narration.StartsWith("UPI-", StringComparison.OrdinalIgnoreCase))
            {
                tx.Mode = "UPI";
                var parts = narration.Split('-');

                int refIdx = -1;
                string? vpa = null;

                for (int i = 0; i < parts.Length; i++)
                {
                    if (Regex.IsMatch(parts[i].Trim(), @"^\d{12,}$"))
                    {
                        refIdx = i;
                        break;
                    }
                }

                if (refIdx > 0)
                {
                    tx.UpiReference = parts[refIdx].Trim();
                    tx.BankCode = refIdx >= 2 ? parts[refIdx - 1].Trim().ToUpper() : null;

                    // VPA is the part containing '@'
                    vpa = parts.FirstOrDefault(p => p.Contains('@'))?.Trim();

                    // Payee name = parts between "UPI" and VPA part
                    int vpaIdx = vpa != null
                        ? Array.IndexOf(parts, parts.First(p => p.Contains('@')))
                        : refIdx - 1;

                    string payeeName = string.Join("-", parts.Skip(1).Take(vpaIdx - 1)).Trim();
                    counterPartyName = payeeName;

                    string remark = string.Join("-", parts.Skip(refIdx + 1)).Trim();
                    if (tx.TransactionType == null)
                        tx.TransactionType = remark.Contains("SEND",
                            StringComparison.OrdinalIgnoreCase) ? "DR" : "CR";
                }
                else
                {
                    counterPartyName = parts.Length > 1 ? parts[1].Trim() : null;
                    vpa = parts.FirstOrDefault(p => p.Contains('@'))?.Trim();
                }

                tx.UpiVpa = vpa;
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
                    string ifsc = m.Groups[2].Value;
                    string party1 = m.Groups[3].Value.Trim();
                    string party2 = m.Groups[4].Value.Trim();
                    string refNo = m.Groups[5].Value.Trim();

                    tx.BankCode = ifsc;
                    tx.UpiReference = refNo;

                    // For CR: party1 is the sender (counterparty paying us)
                    // For DR: party2 is the beneficiary (counterparty we paid)
                    counterPartyName = direction == "CR" ? party1 : party2;

                    if (tx.TransactionType == null)
                        tx.TransactionType = direction;
                }
                else
                {
                    counterPartyName = "NEFT";
                }

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
                else
                {
                    counterPartyName = "IMPS";
                }

                return;
            }

            // FT (Fund Transfer / Salary)
            if (narration.StartsWith("FT-", StringComparison.OrdinalIgnoreCase))
            {
                tx.Mode = "FT";
                var m = FtRegex.Match(narration);
                counterPartyName = m.Success
                    ? m.Groups[3].Value.Trim()   // company name
                    : narration[3..].Trim();

                return;
            }

            // RD Installment
            if (narration.Contains("RD INSTALLMENT",
                StringComparison.OrdinalIgnoreCase))
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
            if (narration.StartsWith("IB BILLPAY",
                StringComparison.OrdinalIgnoreCase))
            {
                tx.Mode = "BILLPAY";
                var m = BillPayRegex.Match(narration);
                if (m.Success)
                {
                    if (tx.TransactionType == null)
                        tx.TransactionType = m.Groups[1].Value.ToUpper();
                    counterPartyName = m.Groups[2].Value.Trim();
                }
                else
                {
                    counterPartyName = "BILL PAYMENT";
                }

                return;
            }

            // IB FD (Fixed Deposit)
            if (narration.StartsWith("IB FD",
                StringComparison.OrdinalIgnoreCase))
            {
                tx.Mode = "FD";
                tx.TransactionType ??= "CR";
                var m = FdRegex.Match(narration);
                counterPartyName = m.Success
                    ? $"FD {m.Groups[1].Value.Trim()}"
                    : "FIXED DEPOSIT";

                return;
            }

            // NWD / ATW (ATM Withdrawal)
            if (narration.StartsWith("NWD-", StringComparison.OrdinalIgnoreCase) ||
                narration.StartsWith("ATW-", StringComparison.OrdinalIgnoreCase))
            {
                tx.Mode = "ATM";
                tx.TransactionType = "DR";
                var m = AtmRegex.Match(narration);
                counterPartyName = m.Success
                    ? $"ATM {m.Groups[4].Value.Trim()}"  // location
                    : "ATM WITHDRAWAL";

                return;
            }

            // Fallback
            tx.Mode = "OTHER";
            counterPartyName = narration.Split('-').FirstOrDefault()?.Trim();
        }

        private static string GenerateReference(BankTransaction tx)
        {
            if (!string.IsNullOrWhiteSpace(tx.UpiReference))
                return $"UPI{tx.UpiReference}";

            var raw = $"{tx.AccountId}|{tx.BankType}|{tx.TransactionDate:yyyyMMdd}|{tx.Mode}|{tx.Amount}|{tx.Balance}";
            var hash = Convert.ToHexString(
                SHA1.HashData(Encoding.UTF8.GetBytes(raw)))[..12];

            return $"GEN{hash}";
        }

        private static DateTime ParseDate(string raw)
        {
            if (DateTime.TryParseExact(raw, "dd/MM/yy",
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.None, out var dt)) return dt;

            if (DateTime.TryParseExact(raw, "dd/MM/yyyy",
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.None, out dt)) return dt;

            throw new FormatException($"Cannot parse date: {raw}");
        }

        private static decimal ParseAmount(string raw)
        {
            var clean = raw.Replace(",", "").Trim();
            return decimal.TryParse(clean, NumberStyles.Any,
                CultureInfo.InvariantCulture, out decimal val) ? val : 0;
        }

        /// <summary>
        /// Splits a CSV line respecting quoted fields.
        /// HDFC uses comma-separated fixed-width padded columns.
        /// HDFC CSV has exactly 7 columns but the Narration (col 1) can contain
        /// commas. Split right-to-left: last 5 fields are always comma-safe,
        /// so take them from the right and treat everything in between as Narration.
        /// Layout: Date | Narration | ValueDate | Debit | Credit | Ref | Balance
        /// </summary>
        private static string[] SplitCsvHdfc(string line)
        {
            var all = line.Split(',');

            if (all.Length == 7)
                return all;

            if (all.Length < 7)
                return all; // malformed — let caller handle

            string date = all[0];
            string valueDate = all[all.Length - 5];
            string debit = all[all.Length - 4];
            string credit = all[all.Length - 3];
            string refNo = all[all.Length - 2];
            string balance = all[all.Length - 1];

            string narration = string.Join(",", all[1..(all.Length - 5)]);

            return new[]
            {
                date, narration, valueDate, debit, credit, refNo, balance
            };
        }

        // ── IBankParser explicit implementation ───────────────────────
        IEnumerable<BaseTransaction> IBankParser.Parse(string text, int accountId)
            => Parse(text, accountId);
    }
}