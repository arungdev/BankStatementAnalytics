using System.Text.RegularExpressions;
using BankStatementAnalytics.Models;
using BankStatementAnalytics.Services.Pdf;
using Common.Framework.Logging;

namespace BankStatementAnalytics.Services.Parser
{
    /// <summary>
    /// Parses normalized rows produced by <see cref="PdfStatementReader"/> with
    /// the HDFC profile (cells: Date | Narration | Ref | ValueDate | Withdrawal |
    /// Deposit | Balance) and delegates transaction building to
    /// <see cref="HdfcTransactionParser.BuildTransaction"/>.
    /// </summary>
    public class HdfcPdfParser : IBankParser
    {
        private static readonly Regex AmountRegex =
            new(@"[\d,]+\.\d{2}", RegexOptions.Compiled);

        public IEnumerable<BankTransaction> Parse(string text, int accountId)
        {
            var transactions = new List<BankTransaction>();
            decimal? prevBalance = null; // HDFC statements run oldest-first

            foreach (var line in text.Replace("\r", "").Split('\n'))
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                try
                {
                    var cells = line.Split(PdfStatementReader.CellSeparator);
                    if (cells.Length < 7) continue;

                    string withdrawal = cells[4];
                    string deposit = cells[5];
                    string balance = cells[6];

                    // Long narrations overflow into the Ref cell on the data row
                    // itself ("INSURA SCBLH09900642049") — the reference is always
                    // the LAST token there.
                    string refNo = cells[2].Trim();
                    int lastSpace = refNo.LastIndexOf(' ');
                    if (lastSpace >= 0) refNo = refNo[(lastSpace + 1)..];

                    // Deposit amounts right-align past the header-derived column
                    // boundary, so they can land in the balance cell alongside the
                    // balance ("1.00 1,422.76"). Split them apart and pick the side
                    // (withdrawal/deposit) from the running balance direction.
                    var balanceAmounts = AmountRegex.Matches(balance);
                    if (withdrawal.Length == 0 && deposit.Length == 0 && balanceAmounts.Count == 2)
                    {
                        string amount = balanceAmounts[0].Value;
                        balance = balanceAmounts[1].Value;
                        decimal balanceVal = decimal.Parse(balance.Replace(",", ""));

                        if (prevBalance.HasValue && balanceVal < prevBalance.Value)
                            withdrawal = amount;
                        else
                            deposit = amount;
                    }

                    // BuildTransaction layout:
                    // [0] Date [1] Narration [2] ValueDate [3] Debit [4] Credit [5] Ref [6] Balance
                    string[] cols = { cells[0], cells[1], cells[3], withdrawal, deposit, refNo, balance };

                    var tx = HdfcTransactionParser.BuildTransaction(cols, accountId);
                    if (tx != null)
                    {
                        transactions.Add(tx);
                        if (tx.Balance != 0) prevBalance = tx.Balance;
                    }
                }
                catch (Exception ex)
                {
                    Log.Error($"HDFC PDF parse error on row: {line.Replace(PdfStatementReader.CellSeparator, '|')}", ex);
                }
            }

            BalanceContinuity.WarnOnGaps(transactions, "HDFC PDF");
            return transactions;
        }
    }
}
