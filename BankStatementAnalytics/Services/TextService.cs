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
            byte[]? pdfBytes = format == StatementFileFormat.Pdf
                ? await File.ReadAllBytesAsync(filePath)
                : null;
            var text = pdfBytes != null
                ? _pdfReader.ExtractNormalizedText(pdfBytes, bank, password)
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

            int newCount = 0;
            using (var session = DbHelper.GetSession())
            {
                // Duplicates keep the UploadId of the upload that first imported them,
                // so `UploadId == x` means "the rows upload x actually added" — that's
                // what both revert and the "N new" drill-down rely on.
                var existingUploadIds = new Dictionary<string, Guid?>();
                var existingRows = session.Query<BankTransaction>()
                    .Where(t => t.AccountId == accountId)
                    .Select(t => new { t.BankReference, t.BankType, t.UploadId })
                    .ToList();
                foreach (var row in existingRows)
                    existingUploadIds[$"{row.BankReference}|{row.BankType}"] = row.UploadId;

                foreach (var tx in transactions)
                {
                    if (existingUploadIds.TryGetValue($"{tx.BankReference}|{tx.BankType}", out var originalUploadId))
                        tx.UploadId = originalUploadId;
                    else
                        newCount++;
                }
            }

            await DbHelper.SaveOrUpdateManyAsync(transactions);

            // Credit card PDFs also carry a statement summary block (dues, due date,
            // limits) — capture it best-effort; a failure here must never undo the
            // transaction import that just succeeded.
            if (pdfBytes != null && bank == Bank.HDFCCreditCard)
                CaptureCardSummary(pdfBytes, accountId, uploadId, password);

            return (transactions.Count, newCount);
        }

        private void CaptureCardSummary(byte[] pdfBytes, int accountId, Guid uploadId, string? password)
        {
            try
            {
                var summary = HdfcCcSummaryExtractor.Extract(_pdfReader, pdfBytes, password);
                if (!summary.HasAnyValue)
                {
                    Log.Info($"CC summary extraction found no fields for account {accountId} (layout change?).");
                    return;
                }

                summary.AccountId = accountId;
                summary.UploadId = uploadId;

                using var session = DbHelper.GetSession();
                using var tx = session.BeginTransaction();

                // One summary per billed statement: re-uploading replaces the row.
                var existing = summary.StatementDate != null
                    ? session.Query<CardStatementSummary>()
                        .FirstOrDefault(s => s.AccountId == accountId && s.StatementDate == summary.StatementDate)
                    : session.Query<CardStatementSummary>()
                        .FirstOrDefault(s => s.AccountId == accountId && s.UploadId == uploadId);

                if (existing != null)
                {
                    existing.UploadId = uploadId;
                    existing.StatementDate = summary.StatementDate;
                    existing.PeriodStart = summary.PeriodStart;
                    existing.PeriodEnd = summary.PeriodEnd;
                    existing.PaymentDueDate = summary.PaymentDueDate;
                    existing.TotalDue = summary.TotalDue;
                    existing.MinimumDue = summary.MinimumDue;
                    existing.CreditLimit = summary.CreditLimit;
                    existing.AvailableCreditLimit = summary.AvailableCreditLimit;
                    existing.RewardPointsBalance = summary.RewardPointsBalance;
                    session.Update(existing);
                }
                else
                {
                    session.Save(summary);
                }

                // Auto-fill the account's card metadata, but only from the newest
                // statement — an older statement uploaded later must not regress it.
                bool isLatest = summary.StatementDate == null ||
                    !session.Query<CardStatementSummary>().Any(s =>
                        s.AccountId == accountId && s.StatementDate > summary.StatementDate);
                if (isLatest)
                {
                    var account = session.Get<Account>((long)accountId);
                    if (account != null)
                    {
                        if (summary.CreditLimit != null) account.CreditLimit = summary.CreditLimit;
                        if (summary.StatementDate != null) account.StatementDay = summary.StatementDate.Value.Day;
                        session.Update(account);
                    }
                }

                tx.Commit();
            }
            catch (Exception ex)
            {
                Log.Exception(ex);
            }
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