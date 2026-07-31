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
    }

    /// <summary>
    /// Shared import pipeline behind both the manual upload endpoint and the
    /// watch-folder auto-importer: validate → dedupe by file hash → store the
    /// file → create Upload rows → parse via TextService → roll back on failure.
    /// Unexpected exceptions are rethrown after cleanup so the HTTP caller keeps
    /// its middleware-logged 500 path; callers own ownership/authorization checks.
    /// </summary>
    public class StatementImportService
    {
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

            var ext = Path.GetExtension(fileName).ToLowerInvariant();
            if (ext != ".txt" && ext != ".csv" && ext != ".pdf")
                return Invalid("Only TXT, CSV and PDF files are supported.");

            var accountId = (int)account.Id;
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
            Directory.CreateDirectory(folder);

            var storedName = $"{accountFolder}/{Guid.NewGuid()}{ext}";
            var path = Path.Combine(UploadStorage.Root, storedName);

            await File.WriteAllBytesAsync(path, bytes);

            var uploadId = Guid.NewGuid();
            var upload = new Upload
            {
                Id = uploadId,
                FileName = fileName,
                StoredName = storedName,
                AccountId = accountId,
                Path = $"/Uploads/{storedName}",
                UploadedAt = DateTime.UtcNow,
                FileHash = fileHash,
                AutoImported = autoImported ? true : null
            };

            var tx = new UploadTransaction
            {
                Id = Guid.NewGuid(),
                UploadId = upload.Id,
                Description = $"Uploaded statement {fileName}",
                CreatedAt = DateTime.UtcNow
            };
            upload.TransactionId = tx.Id;

            // Persist the upload + its transaction record in one round-trip instead of three.
            using (var session = DbHelper.GetSession())
            using (var saveTx = session.BeginTransaction())
            {
                await session.SaveAsync(upload);
                await session.SaveAsync(tx);
                await saveTx.CommitAsync();
            }

            var format = ext switch
            {
                ".csv" => StatementFileFormat.Csv,
                ".pdf" => StatementFileFormat.Pdf,
                _ => StatementFileFormat.Txt,
            };

            int total, newCount;
            try
            {
                (total, newCount) = await _textService.ExtractAsync(
                    path, accountId, uploadId, format, password);
            }
            catch (Exception ex)
            {
                // Extraction/import failed after the Upload row was written — roll
                // back the stored file and DB rows so a corrected retry doesn't
                // trip the duplicate-hash check. Friendly parse errors become an
                // InvalidFile result; anything else rethrows for the caller.
                using (var session = DbHelper.GetSession())
                using (var cleanupTx = session.BeginTransaction())
                {
                    await session.DeleteAsync(tx);
                    await session.DeleteAsync(upload);
                    await cleanupTx.CommitAsync();
                }
                UploadStorage.DeleteFile(storedName);

                if (ex is PdfExtractionException or NotSupportedException)
                    return Invalid(ex.Message);
                throw;
            }

            upload.TotalCount = total;
            upload.NewCount = newCount;
            await DbHelper.UpdateAsync(upload);

            return new StatementImportResult
            {
                Outcome = ImportOutcome.Success,
                Upload = upload,
                Total = total,
                NewCount = newCount
            };
        }

        private static StatementImportResult Invalid(string message) =>
            new() { Outcome = ImportOutcome.InvalidFile, Error = message };
    }
}
