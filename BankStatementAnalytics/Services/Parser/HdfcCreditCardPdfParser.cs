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
    /// the HDFCCreditCard profile (cells: Date | Description | Rewards | Amount | PI).
    /// Real e-statement quirks (measured from a Jun-2026 sample): date cells look
    /// like "08/06/2026| 19:29", amounts like "C 140.00" (rupee glyph extracts as
    /// "C"), and payments/refunds carry a standalone "+" marker; everything else
    /// is a purchase (debit). Narration classification and reference generation
    /// are reused from <see cref="HdfcCreditCardParser"/>.
    /// </summary>
    public class HdfcCreditCardPdfParser : IBankParser
    {
        private static readonly string[] DateFormats =
            { "dd/MM/yyyy HH:mm:ss", "dd/MM/yyyy HH:mm", "dd/MM/yyyy", "dd/MM/yy" };

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
                    if (cells.Length < 5) continue;

                    var tx = BuildTransaction(cells, accountId);
                    if (tx != null) transactions.Add(tx);
                }
                catch (Exception ex)
                {
                    Log.Error($"HDFC CC PDF parse error on row: {line.Replace(PdfStatementReader.CellSeparator, '|')}", ex);
                }
            }

            return transactions;
        }

        private static BankTransaction? BuildTransaction(string[] cells, int accountId)
        {
            string desc = cells[1].Trim();

            // "08/06/2026| 19:29" → "08/06/2026 19:29"
            string dateRaw = Regex.Replace(cells[0].Trim(), @"\|\s*", " ").Trim();
            if (!DateTime.TryParseExact(dateRaw, DateFormats,
                    CultureInfo.InvariantCulture, DateTimeStyles.None, out var txDate))
                return null;

            // The "+" (credit) marker and the amount can straddle the Description/
            // Rewards/Amount column boundaries, so scan those cells for both —
            // Amount cell first so a number in the description can't win.
            bool isCredit = false;
            decimal amount = 0;
            foreach (int i in new[] { 3, 2, 1 })
            {
                string cell = cells[i];
                if (cell.Contains('+') || cell.EndsWith("Cr", StringComparison.OrdinalIgnoreCase))
                    isCredit = true;
                if (amount == 0)
                {
                    var m = AmountRegex.Match(cell);
                    if (m.Success)
                        amount = decimal.Parse(m.Value.Replace(",", ""), CultureInfo.InvariantCulture);
                }
            }

            if (amount <= 0) return null;

            var tx = new BankTransaction
            {
                AccountId = accountId,
                BankType = BankTypeCode.For(Bank.HDFCCreditCard),
                BankReference = string.Empty, // filled below
                TransactionDate = txDate,
                ValueDate = txDate,
                TransactionType = isCredit ? "CR" : "DR",
                Description = desc,
                Narration = desc,
                Amount = amount,
                Debit = isCredit ? 0 : amount,
                Credit = isCredit ? amount : 0,
                Balance = 0, // CC statements have no per-row running balance
                ImportedOn = DateTime.Now,
            };

            HdfcCreditCardParser.ParseNarration(desc, tx, out string? counterPartyName);

            // Payment rows wrap their description across neighbouring visual rows
            // that this layout discards (ContinuationMode.None) — label them
            // rather than leaving an anonymous credit. Bill payments are the
            // user's own money arriving from their bank account, so mark them
            // TRANSFER; analytics exclude TRANSFER rows from income/spend.
            bool isBillPayment = isCredit &&
                (string.IsNullOrWhiteSpace(desc) ||
                 desc.Contains("CREDIT CARD PAYMENT", StringComparison.OrdinalIgnoreCase));
            if (isBillPayment)
            {
                tx.Mode = "TRANSFER";
                counterPartyName = "CREDIT CARD PAYMENT";
                if (string.IsNullOrWhiteSpace(desc))
                {
                    tx.Description = counterPartyName;
                    tx.Narration = counterPartyName;
                }
            }

            if (!string.IsNullOrWhiteSpace(counterPartyName))
                tx.PendingCounterPartyName = counterPartyName;

            tx.BankReference = string.IsNullOrWhiteSpace(tx.UpiReference)
                ? HdfcCreditCardParser.GenerateReference(tx)
                : $"HDFCCC{tx.UpiReference}";

            return tx;
        }

        private static decimal ParseAmount(string raw)
        {
            var clean = raw.Replace(",", "").Trim();
            return decimal.TryParse(clean, NumberStyles.Any,
                CultureInfo.InvariantCulture, out decimal val) ? val : 0;
        }
    }
}
