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
        public string FileExt { get; set; } = string.Empty;  // ".txt", ".csv" or ".pdf"
        public Type ParserType { get; set; } = null!;  // must implement IBankParser
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
            // not the raw file bytes (see PrepareAsync).
            new() { Bank = Bank.HDFC,           FileExt = ".pdf", ParserType = typeof(HdfcPdfParser)           },
            new() { Bank = Bank.IOB,             FileExt = ".pdf", ParserType = typeof(IobPdfParser)            },
            new() { Bank = Bank.HDFCCreditCard,  FileExt = ".pdf", ParserType = typeof(HdfcCreditCardPdfParser) },
        };
    }

    public sealed record PreparedStatement(List<BankTransaction> Transactions, CardStatementSummary? Summary, List<string> Warnings);

    public class TextService
    {
        private readonly IServiceProvider _serviceProvider;
        private readonly CounterPartyService _counterPartyService;
        private readonly PdfStatementReader _pdfReader;
        private readonly RuleEngineService _ruleEngine;

        public TextService(
            IServiceProvider serviceProvider,
            CounterPartyService counterPartyService,
            PdfStatementReader pdfReader,
            RuleEngineService ruleEngine)
        {
            _serviceProvider = serviceProvider;
            _counterPartyService = counterPartyService;
            _pdfReader = pdfReader;
            _ruleEngine = ruleEngine;
        }

        /// <summary>
        /// Parse and validate without financial writes. Persistence is performed
        /// separately in the importer's transaction, together with completion status.
        /// </summary>
        public async Task<PreparedStatement> PrepareAsync(
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

            if (transactions.Count == 0)
                throw new NotSupportedException("No transactions could be parsed. Check the bank and statement format.");

            var warnings = bank == Bank.HDFCCreditCard ? new List<string>() : BalanceContinuity.FindGaps(transactions);
            var unresolved = transactions.Count(t => string.IsNullOrWhiteSpace(t.PendingCounterPartyName));
            if (unresolved > 0) warnings.Add($"{unresolved} transaction(s) have no recognized merchant.");
            CardStatementSummary? summary = null;
            if (pdfBytes != null && bank == Bank.HDFCCreditCard)
            {
                try
                {
                    summary = HdfcCcSummaryExtractor.Extract(_pdfReader, pdfBytes, password);
                    if (!summary.HasAnyValue) { warnings.Add("Credit-card summary could not be extracted."); summary = null; }
                }
                catch (Exception ex)
                {
                    Log.Exception(ex);
                    warnings.Add("Credit-card summary could not be extracted. Review the statement manually.");
                }
            }
            return new PreparedStatement(transactions, summary, warnings);
        }

        public async Task<int> PersistAsync(NHibernate.ISession session, Account account,
            Guid uploadId, PreparedStatement prepared)
        {
            // Limit the lookup to references present in this statement. Chunking
            // keeps SQLite parameter counts and large Postgres IN lists bounded.
            var existing = new HashSet<(string Reference, string Bank, string Direction)>();
            foreach (var references in prepared.Transactions.Select(t => t.BankReference).Distinct().Chunk(400))
            {
                var referenceList = references.ToList();
                var rows = session.Query<BankTransaction>()
                    .Where(t => t.AccountId == account.Id && referenceList.Contains(t.BankReference))
                    .Select(t => new { t.BankReference, t.BankType, t.TransactionType }).ToList();
                foreach (var row in rows) existing.Add((row.BankReference, row.BankType, row.TransactionType));
            }
            var newRows = prepared.Transactions.Where(t =>
                existing.Add((t.BankReference, t.BankType, t.TransactionType))).ToList();
            // Existing rows keep user categories, notes, tags and their original
            // upload. Re-importing overlapping periods never overwrites edits.
            _counterPartyService.ResolveOrCreateBatch(session, account.Id, newRows);
            if (account.OwnerUserId.HasValue) _ruleEngine.ApplyRules(session, account.OwnerUserId.Value, newRows);
            foreach (var row in newRows)
            {
                row.UploadId = uploadId;
                await session.SaveAsync(row);
            }
            if (prepared.Summary != null) PersistCardSummary(session, account, uploadId, prepared.Summary);
            return newRows.Count;
        }

        private static void PersistCardSummary(NHibernate.ISession session, Account account,
            Guid uploadId, CardStatementSummary summary)
        {
            summary.AccountId = account.Id;
            summary.UploadId = uploadId;
            var existing = summary.StatementDate.HasValue
                ? session.Query<CardStatementSummary>().FirstOrDefault(s => s.AccountId == account.Id && s.StatementDate == summary.StatementDate)
                : null;
            if (existing == null) session.Save(summary);
            else
            {
                existing.UploadId = uploadId;
                existing.PeriodStart = summary.PeriodStart;
                existing.PeriodEnd = summary.PeriodEnd;
                existing.PaymentDueDate = summary.PaymentDueDate;
                existing.TotalDue = summary.TotalDue;
                existing.MinimumDue = summary.MinimumDue;
                existing.CreditLimit = summary.CreditLimit;
                existing.AvailableCreditLimit = summary.AvailableCreditLimit;
                existing.RewardPointsBalance = summary.RewardPointsBalance;
            }
            if (summary.StatementDate.HasValue && !session.Query<CardStatementSummary>()
                .Any(s => s.AccountId == account.Id && s.StatementDate > summary.StatementDate))
            {
                if (summary.CreditLimit.HasValue) account.CreditLimit = summary.CreditLimit;
                account.StatementDay = summary.StatementDate.Value.Day;
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
            return account?.BankName ?? throw new InvalidOperationException($"Account {accountId} not found.");
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
