using System.Globalization;
using System.Text.RegularExpressions;
using BankStatementAnalytics.EnumClass;
using BankStatementAnalytics.Models;
using BankStatementAnalytics.Services.Pdf;
using Common.Framework.Logging;

namespace BankStatementAnalytics.Services.Parser
{
    /// <summary>
    /// Parses normalized rows produced by <see cref="PdfStatementReader"/> with
    /// the IOB profile (cells: Date | ValueDate | Chq | Remarks | Cod | Debit |
    /// Credit | Balance). Debit/credit come from explicit columns, so the
    /// char-column threshold heuristic of the .txt parser is unnecessary; remark
    /// classification and reference generation are reused from
    /// <see cref="OpTransactionParser"/>.
    /// </summary>
    public class IobPdfParser : IBankParser
    {
        private static readonly string[] DateFormats = { "dd/MM/yyyy", "dd-MM-yyyy", "dd/MM/yy" };

        // Amount cells can carry the "TRF" transaction-type marker from the
        // neighbouring column ("TRF 445.00"), so extract the number by pattern
        // (Indian lakh format) instead of parsing the whole cell.
        private static readonly Regex AmountRegex =
            new(@"[\d,]+\.\d{2}", RegexOptions.Compiled);

        public IEnumerable<BankTransaction> Parse(string text, int accountId)
        {
            var transactions = new List<BankTransaction>();

            foreach (var line in text.Replace("\r", "").Split('\n'))
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                try
                {
                    var cells = line.Split(PdfStatementReader.CellSeparator);
                    if (cells.Length < 8) continue;

                    var tx = BuildTransaction(cells, accountId);
                    if (tx != null) transactions.Add(tx);
                }
                catch (Exception ex)
                {
                    Log.Error($"IOB PDF parse error on row: {line.Replace(PdfStatementReader.CellSeparator, '|')}", ex);
                }
            }

            BalanceContinuity.WarnOnGaps(transactions, "IOB PDF");
            return transactions;
        }

        private static BankTransaction? BuildTransaction(string[] cells, int accountId)
        {
            string remarks = cells[3].Trim();

            // Remark text can straddle the neighbouring column boundaries: a
            // non-numeric CHQ cell ("CASH", "CHRGS-") is really the start of the
            // remark, and COD tokens other than the TRF/CLG markers are its tail
            // ("SMS ALERT JUL TO SEP" | "2025 TRF").
            string chq = cells[2].Trim();
            bool chqIsChequeNo = chq.Length > 0 && chq.All(char.IsDigit);
            if (chq.Length > 0 && !chqIsChequeNo)
                remarks = (chq + " " + remarks).Trim();

            string codExtra = string.Join(" ",
                cells[4].Split(' ', StringSplitOptions.RemoveEmptyEntries)
                        .Where(t => t is not ("TRF" or "CLG")));
            if (codExtra.Length > 0)
                remarks = (remarks + " " + codExtra).Trim();

            if (!TryParseDate(cells[0].Trim(), out var txDate)) return null;

            var tx = new BankTransaction
            {
                ImportedOn = DateTime.Now,
                Description = remarks,
                AccountId = accountId,
                BankType = BankTypeCode.For(Bank.IOB),
                TransactionDate = txDate,
                ValueDate = TryParseDate(cells[1].Trim(), out var valDate) ? valDate : txDate,
                ChequeNumber = chqIsChequeNo ? chq : string.Empty,
            };

            decimal debit = ExtractAmount(cells[5]);
            decimal credit = ExtractAmount(cells[6]);
            tx.Balance = ExtractAmount(cells[7]);

            if (debit > 0)
            {
                tx.Amount = debit;
                tx.TransactionType = "DR";
            }
            else if (credit > 0)
            {
                tx.Amount = credit;
                tx.TransactionType = "CR";
            }

            // May override TransactionType (the UPI/…/CR|DR marker wins over
            // column position, matching the .txt parser's behaviour).
            OpTransactionParser.ParseRemarks(remarks, tx, out string? counterPartyName);

            // Column assignment near the debit/credit boundary can be off by one
            // when amounts straddle it, so align Debit/Credit with the FINAL
            // transaction type rather than trusting the cell position blindly.
            if (tx.TransactionType == "CR")
            {
                tx.Credit = tx.Amount;
                tx.Debit = 0;
            }
            else if (tx.TransactionType == "DR")
            {
                tx.Debit = tx.Amount;
                tx.Credit = 0;
            }

            tx.BankReference = OpTransactionParser.GenerateReference(tx);

            if (!string.IsNullOrWhiteSpace(counterPartyName))
                tx.PendingCounterPartyName = counterPartyName;

            return tx;
        }

        private static bool TryParseDate(string raw, out DateTime dt) =>
            DateTime.TryParseExact(raw, DateFormats,
                CultureInfo.InvariantCulture, DateTimeStyles.None, out dt);

        private static decimal ExtractAmount(string raw)
        {
            var m = AmountRegex.Match(raw);
            return m.Success
                ? decimal.Parse(m.Value.Replace(",", ""), CultureInfo.InvariantCulture)
                : 0;
        }
    }
}
