using BankStatementAnalytics.EnumClass;
using BankStatementAnalytics.Models;
using BankStatementAnalytics.Services.Parser;
using BankStatementAnalytics.Services.Pdf;
using Common.Framework.Data;
using Common.Framework.Logging;
using Microsoft.Extensions.DependencyInjection;

namespace BankStatementAnalytics.Services
{
    // ── Parser registration entry ─────────────────────────────────────────
    public class BankParserConfig
    {
        public Bank Bank { get; set; }
        public string FileExt { get; set; }  // ".txt", ".csv" or ".pdf"
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
            // PDF parsers consume normalized text produced by PdfStatementReader,
            // not the raw file bytes (see ExtractAsync).
            new() { Bank = Bank.HDFC,           FileExt = ".pdf", ParserType = typeof(HdfcPdfParser)           },
            new() { Bank = Bank.IOB,             FileExt = ".pdf", ParserType = typeof(IobPdfParser)            },
            new() { Bank = Bank.HDFCCreditCard,  FileExt = ".pdf", ParserType = typeof(HdfcCreditCardPdfParser) },
        };
    }

    public class TextService
    {
        private readonly IServiceProvider _serviceProvider;
        private readonly CounterPartyService _counterPartyService;
        private readonly PdfStatementReader _pdfReader;

        public TextService(
            IServiceProvider serviceProvider,
            CounterPartyService counterPartyService,
            PdfStatementReader pdfReader)
        {
            _serviceProvider = serviceProvider;
            _counterPartyService = counterPartyService;
            _pdfReader = pdfReader;
        }

        /// <summary>
        /// Parses the statement and upserts its transactions. Returns the total number of
        /// transactions found in the file and how many of them were new (not already imported).
        /// </summary>
        public async Task<(int total, int newCount)> ExtractAsync(
            string filePath, int accountId, Guid uploadId, StatementFileFormat format,
            string? password = null)
        {
            var ext = format switch
            {
                StatementFileFormat.Csv => ".csv",
                StatementFileFormat.Pdf => ".pdf",
                _ => ".txt",
            };
            var bank = GetBankName(accountId);

            var config = BankParserRegistry.Parsers
                .FirstOrDefault(p => p.Bank == bank && p.FileExt == ext);

            if (config == null && format == StatementFileFormat.Csv)
                throw new NotSupportedException(
                    $"CSV upload is not supported for bank: {bank}. " +
                    $"Registered CSV banks: {string.Join(", ", BankParserRegistry.Parsers.Where(p => p.FileExt == ".csv").Select(p => p.Bank))}");

            // FallbackDetect sniffs raw-text markers, which are meaningless for
            // PDFs — a PDF without a registered parser is simply unsupported.
            if (config == null && format == StatementFileFormat.Pdf)
                throw new NotSupportedException($"PDF upload is not supported for bank: {bank}.");

            // PDFs are converted to normalized delimiter-separated rows first;
            // text/CSV statements are parsed from the raw file content.
            var text = format == StatementFileFormat.Pdf
                ? _pdfReader.ExtractNormalizedText(await File.ReadAllBytesAsync(filePath), bank, password)
                : await File.ReadAllTextAsync(filePath);

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

            // Resolve all counterparty names to merchants in a single batch (one session /
            // transaction) instead of a session per parsed row.
            _counterPartyService.ResolveOrCreateBatch(accountId, transactions);

            int newCount;
            using (var session = DbHelper.GetSession())
            {
                var existingKeys = session.Query<BankTransaction>()
                    .Where(t => t.AccountId == accountId)
                    .Select(t => new { t.BankReference, t.BankType })
                    .ToList()
                    .Select(x => $"{x.BankReference}|{x.BankType}")
                    .ToHashSet();

                newCount = transactions.Count(t => !existingKeys.Contains($"{t.BankReference}|{t.BankType}"));
            }

            await DbHelper.SaveOrUpdateManyAsync(transactions);

            return (transactions.Count, newCount);
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