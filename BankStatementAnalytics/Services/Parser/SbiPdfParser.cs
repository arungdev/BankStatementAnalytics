using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using BankStatementAnalytics.Models;
using BankStatementAnalytics.Services.Pdf;

namespace BankStatementAnalytics.Services.Parser;

public class SbiPdfParser : IBankParser
{
    public IEnumerable<BankTransaction> Parse(string text, int accountId)
    {
        var result = new List<BankTransaction>();
        foreach (var line in text.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            var c = line.TrimEnd('\r').Split(PdfStatementReader.CellSeparator);
            if (c.Length != 7 || !DateTime.TryParseExact(c[0], "dd/MM/yyyy", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
                throw new PdfExtractionException("An SBI transaction row has an unsupported date or column layout.");
            decimal debit = Amount(c[4]), credit = Amount(c[5]), balance = Amount(c[6], true);
            if ((debit <= 0 && credit <= 0) || (debit > 0 && credit > 0))
                throw new PdfExtractionException("An SBI transaction could not be assigned to a debit or credit column.");
            var narration = Regex.Replace(c[2], @"\s+", " ").Trim();
            var upi = Regex.Match(narration, @"UPI/(?:CR|DR)/(\d+)/(.+?)(?:/|$)", RegexOptions.IgnoreCase);
            var neft = Regex.Match(narration, @"NEFT\*[^*]+\*([^*]+)\*([^*]+)", RegexOptions.IgnoreCase);
            var valueDate = DateTime.ParseExact(c[1], "dd/MM/yyyy", CultureInfo.InvariantCulture);
            var tx = new BankTransaction
            {
                AccountId = accountId, BankType = "SBI", TransactionDate = date, ValueDate = valueDate,
                Description = narration, Narration = narration, Debit = debit, Credit = credit, Balance = balance,
                Amount = debit + credit, TransactionType = debit > 0 ? "DR" : "CR",
                Mode = upi.Success ? "UPI" : neft.Success ? "NEFT" : narration.Contains("ATM", StringComparison.OrdinalIgnoreCase) ? "ATM" : "OTHER",
                UpiReference = upi.Success ? upi.Groups[1].Value : "",
                PendingCounterPartyName = upi.Success ? upi.Groups[2].Value.Trim() : neft.Success ? neft.Groups[2].Value.Trim() : null,
                ChequeNumber = c[3] == "-" ? "" : c[3]
            };
            // Include the balance to distinguish otherwise identical repeated payments.
            string identity = string.Join("|", date.ToString("yyyy-MM-dd"), valueDate.ToString("yyyy-MM-dd"), narration, c[3], debit.ToString(CultureInfo.InvariantCulture), credit.ToString(CultureInfo.InvariantCulture), balance.ToString(CultureInfo.InvariantCulture));
            tx.BankReference = "SBI" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(identity)))[..32];
            result.Add(tx);
        }
        return result;
    }

    private static decimal Amount(string text, bool required = false)
    {
        text = text.Trim();
        if (!required && (text.Length == 0 || text == "-")) return 0;
        bool dr = text.EndsWith("DR", StringComparison.OrdinalIgnoreCase);
        text = Regex.Replace(text, @"\s*(CR|DR)$", "", RegexOptions.IgnoreCase);
        if (!decimal.TryParse(text, NumberStyles.Number, CultureInfo.InvariantCulture, out var value))
            throw new PdfExtractionException("An SBI amount could not be read. The statement layout may not be supported.");
        return dr ? -value : value;
    }
}
