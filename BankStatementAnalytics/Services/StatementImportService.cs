using BankStatementAnalytics.EnumClass;
using BankStatementAnalytics.Models;
using BankStatementAnalytics.Services.Pdf;
using Common.Framework.Data;
using NHibernate.Linq;
using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;

namespace BankStatementAnalytics.Services
{
    public enum ImportOutcome
    {
        Success,
        Duplicate,      // same file (hash) already uploaded for this account
        InvalidFile     // empty / unsupported / unparsable — safe to report to the user
    }

    public sealed class StatementImportResult
    {
        public ImportOutcome Outcome { get; init; }
        public string? Error { get; init; }
        public Upload? Upload { get; init; }
        public int Total { get; init; }
        public int NewCount { get; init; }
        public IReadOnlyList<string> Warnings { get; init; } = Array.Empty<string>();
    }

    /// <summary>
    /// Shared import pipeline behind both the manual upload endpoint and the
    /// watch-folder auto-importer: validate → reserve the file hash → store and
    /// parse the file → commit financial records and completion together.
    /// Unexpected exceptions are rethrown after cleanup so the HTTP caller keeps
    /// its middleware-logged 500 path; callers own ownership/authorization checks.
    /// </summary>
    public class StatementImportService
    {
        public const long MaxFileBytes = 25_000_000;
        private readonly TextService _textService;
        private readonly PdfStatementReader _pdfReader;

        public StatementImportService(TextService textService, PdfStatementReader pdfReader)
        {
            _textService = textService;
            _pdfReader = pdfReader;
        }

        public async Task<StatementImportResult> ImportAsync(
            Account account, byte[] bytes, string fileName, string? password, bool autoImported)
        {
            if (bytes == null || bytes.Length == 0)
                return Invalid("File is empty");

            if (bytes.LongLength > MaxFileBytes) return Invalid("Statement exceeds the 25 MB limit.");
            fileName = Path.GetFileName(fileName);
            var ext = Path.GetExtension(fileName).ToLowerInvariant();
            if (ext != ".txt" && ext != ".csv" && ext != ".pdf")
                return Invalid("Only TXT, CSV and PDF files are supported.");
            if (ext == ".pdf" && bytes.AsSpan(0, Math.Min(bytes.Length, 1024)).IndexOf("%PDF-"u8) < 0)
                return Invalid("The file content is not a PDF.");
            if (ext != ".pdf" && bytes.Length >= 2 && (bytes[0] == 'M' && bytes[1] == 'Z' || bytes[0] == 'P' && bytes[1] == 'K'))
                return Invalid("Binary files are not supported as text statements.");

            var accountId = (int)account.Id;
            using var accountGate = await ImportAccountGate.AcquireAsync(account.Id);
            var fileHash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes));

            // Reject an exact re-upload of the same file for the same account.
            // Checked before the PDF pre-flight below: a file that is already in
            // is a duplicate whether or not we can open it now, and re-validating
            // it would report a password failure for a statement already imported
            // (the watch folder still holds the source file, and the password used
            // for a manual upload is never persisted to the account).
            using (var checkSession = DbHelper.GetSession())
            {
                bool alreadyUploaded = checkSession.Query<Upload>()
                    .Any(u => u.AccountId == accountId && u.FileHash == fileHash);
                if (alreadyUploaded)
                    return new StatementImportResult
                    {
                        Outcome = ImportOutcome.Duplicate,
                        Error = "This statement file has already been uploaded for this account."
                    };
            }

            // Pre-flight PDFs BEFORE any DB write: a wrong password / scanned PDF
            // must not leave an Upload row behind, or the corrected retry would
            // trip the duplicate-hash check above.
            if (ext == ".pdf")
            {
                try
                {
                    _pdfReader.Validate(bytes, password);
                }
                catch (PdfExtractionException pex)
                {
                    return Invalid(pex.Message);
                }
            }

            var accountFolder = UploadStorage.AccountFolderName(account);
            var folder = Path.Combine(UploadStorage.Root, accountFolder);
            var retainOriginal = !SecurityRuntime.PublicHosting;
            if (retainOriginal) Directory.CreateDirectory(folder);

            var storedName = retainOriginal ? $"{accountFolder}/{Guid.NewGuid()}{ext}" : "";
            var path = retainOriginal ? UploadStorage.ResolvePath(storedName) : "";

            var uploadId = Guid.NewGuid();
            var upload = new Upload
            {
                Id = uploadId,
                FileName = fileName,
                StoredName = storedName,
                AccountId = accountId,
                Path = retainOriginal ? $"/Uploads/{storedName}" : "",
                UploadedAt = DateTime.UtcNow,
                FileHash = fileHash,
                AutoImported = autoImported ? true : null,
                ImportStatus = "Pending"
            };

            var tx = new UploadTransaction
            {
                Id = Guid.NewGuid(),
                UploadId = upload.Id,
                Description = $"Uploaded statement {fileName}",
                CreatedAt = DateTime.UtcNow
            };
            upload.TransactionId = tx.Id;

            // Reserve the hash before writing a file. The unique database index
            // makes manual/watch-folder races safe across processes too.
            try
            {
                using var session = DbHelper.GetSession();
                using var reservation = session.BeginTransaction();
                await session.SaveAsync(upload);
                await session.SaveAsync(tx);
                await reservation.CommitAsync();
            }
            catch
            {
                using var check = DbHelper.GetSession();
                var reserved = check.Query<Upload>().FirstOrDefault(u => u.AccountId == accountId && u.FileHash == fileHash);
                if (reserved != null && reserved.Id != upload.Id)
                    return new StatementImportResult { Outcome = ImportOutcome.Duplicate,
                        Error = "This statement is already imported or an import is in progress." };
                // A commit can succeed before the connection reports failure.
                // Continue our own durable reservation instead of stranding it.
                if (reserved == null) throw;
            }

            var format = ext switch
            {
                ".csv" => StatementFileFormat.Csv,
                ".pdf" => StatementFileFormat.Pdf,
                _ => StatementFileFormat.Txt,
            };
            try
            {
                if (retainOriginal) await File.WriteAllBytesAsync(path, bytes);
                var prepared = _textService.Prepare(bytes, fileName, accountId, upload.Id, format, password);
                using var session = DbHelper.GetSession();
                using var import = session.BeginTransaction();
                // Serialize overlapping statements for this account; otherwise
                // two different files can both discover the same row as new.
                var lockedAccount = await session.GetAsync<Account>(account.Id, NHibernate.LockMode.Upgrade);
                var storedUpload = await session.GetAsync<Upload>(upload.Id);
                var added = await _textService.PersistAsync(session, lockedAccount, upload.Id, prepared);
                storedUpload.TotalCount = prepared.Transactions.Count;
                storedUpload.NewCount = added;
                storedUpload.ImportWarnings = System.Text.Json.JsonSerializer.Serialize(prepared.Warnings);
                storedUpload.ImportStatus = "Complete";
                await import.CommitAsync();
                return new StatementImportResult { Outcome = ImportOutcome.Success, Upload = storedUpload,
                    Total = storedUpload.TotalCount, NewCount = added, Warnings = prepared.Warnings };
            }
            catch (Exception ex)
            {
                // A lost connection during commit has an uncertain outcome. Never
                // delete a completed import: its status committed with its rows.
                using var session = DbHelper.GetSession();
                var stored = await session.GetAsync<Upload>(upload.Id);
                if (stored?.ImportStatus == "Complete")
                    return new StatementImportResult { Outcome = ImportOutcome.Success, Upload = stored,
                        Total = stored.TotalCount, NewCount = stored.NewCount,
                        Warnings = System.Text.Json.JsonSerializer.Deserialize<List<string>>(stored.ImportWarnings ?? "[]") ?? [] };
                // Delete the file first. If cleanup fails, Pending remains for
                // startup recovery instead of losing the only record of the file.
                UploadStorage.DeleteFile(storedName);
                using var cleanup = session.BeginTransaction();
                var record = await session.GetAsync<UploadTransaction>(tx.Id);
                if (record != null) await session.DeleteAsync(record);
                if (stored != null) await session.DeleteAsync(stored);
                await cleanup.CommitAsync();
                if (ex is PdfExtractionException or NotSupportedException) return Invalid(ex.Message);
                throw;
            }
        }

        private static StatementImportResult Invalid(string message) =>
            new() { Outcome = ImportOutcome.InvalidFile, Error = message };
    }
}
