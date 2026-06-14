using BankStatementAnalytics.Data;
using BankStatementAnalytics.Models;
using BankStatementAnalytics.Services.Parser;
using Common.Framework.Data;

namespace BankStatementAnalytics.Services
{
    public class TextService
    {
        private readonly IServiceProvider _serviceProvider;

        public TextService(IServiceProvider serviceProvider)
        {
            _serviceProvider = serviceProvider;
        }

        public string ExtractText(string filePath, int accountId, Guid uploadId)
        {
            var text = File.ReadAllText(filePath);
            var bank = GetBankName(accountId);

            IBankParser parser = bank switch
            {
                Bank.HDFC => _serviceProvider.GetRequiredService<HdfcTransactionParser>(),
                Bank.IOB => _serviceProvider.GetRequiredService<OpTransactionParser>(),
                _ => FallbackDetect(text, filePath)
            };

            var transactions = parser.Parse(text, accountId).ToList();

            foreach (var tx in transactions)
            {
                if (tx is BaseTransaction baseTx)
                {
                    baseTx.UploadId = uploadId;
                    baseTx.AccountId = accountId;
                }
            }

            DbHelper.SaveOrUpdateManyAsync(transactions).GetAwaiter().GetResult();

            return text;
        }

        // ── NEW: CSV entry point for credit card statements ───────────────
        public async Task ExtractCsvAsync(string filePath, int accountId, Guid uploadId)
        {
            var bank = GetBankName(accountId);

            if (bank == Bank.HDFCCreditCard)
            {
                var ccService = _serviceProvider.GetRequiredService<HdfcCreditCardService>();
                await ccService.ExtractAsync(filePath, accountId, uploadId);
            }
            else
            {
                throw new NotSupportedException(
                    $"CSV upload is not supported for bank: {bank}. " +
                    $"Only HDFC Credit Card CSV statements are currently supported.");
            }
        }

        // ── Fetch BankName from Accounts table ───────────────────────────
        private static Bank GetBankName(int accountId)
        {
            using var session = DbHelper.GetSession();
            var account = session.Get<Account>((long)accountId);
            return (Bank)account?.BankName;
        }

        // ── Fallback: detect from file content if BankName is empty ──────
        private IBankParser FallbackDetect(string text, string filePath)
        {
            var head = text.Length > 500 ? text[..500] : text;

            if (head.Contains("Narration") &&
                head.Contains("Debit Amount") &&
                head.Contains("Chq/Ref Number") &&
                head.Contains("Closing Balance"))
                return _serviceProvider.GetRequiredService<HdfcTransactionParser>();

            if (head.Contains("TRF") ||
                head.Contains("UPI/") ||
                head.Contains("Statement for the period"))
                return _serviceProvider.GetRequiredService<OpTransactionParser>();

            throw new NotSupportedException(
                $"Cannot detect bank format for file: {Path.GetFileName(filePath)}. " +
                $"Please ensure the Account has a BankName set (HDFC or IOB).");
        }
    }
}