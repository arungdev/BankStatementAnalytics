using BankStatementAnalytics.EnumClass;
using BankStatementAnalytics.Models;
using BankStatementAnalytics.Services.Parser;
using Common.Framework.Data;
using Microsoft.Extensions.DependencyInjection;

namespace BankStatementAnalytics.Services
{
    // ── Parser registration entry ─────────────────────────────────────────
    public class BankParserConfig
    {
        public Bank Bank { get; set; }
        public string FileExt { get; set; }  // ".txt" or ".csv"
        public Type ParserType { get; set; }  // must implement IBankParser
    }

    // ── Registry — add/remove banks here only ────────────────────────────
    public static class BankParserRegistry
    {
        public static readonly List<BankParserConfig> Parsers = new()
        {
            new() { Bank = Bank.HDFC,           FileExt = ".txt", ParserType = typeof(HdfcTransactionParser)   },
            new() { Bank = Bank.IOB,             FileExt = ".txt", ParserType = typeof(OpTransactionParser)     },
            new() { Bank = Bank.HDFCCreditCard,  FileExt = ".csv", ParserType = typeof(HdfcCreditCardParser)   },
        };
    }

    public class TextService
    {
        private readonly IServiceProvider _serviceProvider;

        public TextService(IServiceProvider serviceProvider)
        {
            _serviceProvider = serviceProvider;
        }

        public async Task ExtractAsync(
            string filePath, int accountId, Guid uploadId, StatementFileFormat format)
        {
            var ext = format == StatementFileFormat.Csv ? ".csv" : ".txt";
            var bank = GetBankName(accountId);
            var text = await File.ReadAllTextAsync(filePath);

            var config = BankParserRegistry.Parsers
                .FirstOrDefault(p => p.Bank == bank && p.FileExt == ext);

            if (config == null && format == StatementFileFormat.Csv)
                throw new NotSupportedException(
                    $"CSV upload is not supported for bank: {bank}. " +
                    $"Registered CSV banks: {string.Join(", ", BankParserRegistry.Parsers.Where(p => p.FileExt == ".csv").Select(p => p.Bank))}");

            IBankParser parser = config != null
                ? (IBankParser)_serviceProvider.GetRequiredService(config.ParserType)
                : FallbackDetect(text, filePath);

            var transactions = parser.Parse(text, accountId)
                                     .OfType<BankTransaction>()
                                     .ToList();

            foreach (var tx in transactions)
            {
                tx.UploadId = uploadId;
                tx.AccountId = accountId;
            }

            await DbHelper.SaveOrUpdateManyAsync(transactions);
        }


        // ── Supported formats for an account (used by the API endpoint) ──
        public static (string[] formats, string label) GetSupportedFormats(Bank bank)
        {
            var exts = BankParserRegistry.Parsers
                .Where(p => p.Bank == bank)
                .Select(p => p.FileExt)
                .Distinct()
                .ToArray();

            var label = string.Join(", ", exts.Select(e => e.TrimStart('.').ToUpper()));
            return (exts, label);
        }

        // ── Fetch BankName from Accounts table ────────────────────────────
        private static Bank GetBankName(int accountId)
        {
            using var session = DbHelper.GetSession();
            var account = session.Get<Account>((long)accountId);
            return (Bank)account?.BankName;
        }

        // ── Fallback: detect from file content ───────────────────────────
        private IBankParser FallbackDetect(string text, string filePath)
        {
            var head = text.Length > 500 ? text[..500] : text;

            if (head.Contains("Narration") &&
                head.Contains("Debit Amount") &&
                head.Contains("Chq/Ref Number") &&
                head.Contains("Closing Balance"))
                return (IBankParser)_serviceProvider.GetRequiredService(
                    BankParserRegistry.Parsers.First(p => p.Bank == Bank.HDFC && p.FileExt == ".txt").ParserType);

            if (head.Contains("TRF") ||
                head.Contains("UPI/") ||
                head.Contains("Statement for the period"))
                return (IBankParser)_serviceProvider.GetRequiredService(
                    BankParserRegistry.Parsers.First(p => p.Bank == Bank.IOB).ParserType);

            throw new NotSupportedException(
                $"Cannot detect bank format for file: {Path.GetFileName(filePath)}. " +
                $"Please ensure the Account has a BankName set.");
        }
    }
}