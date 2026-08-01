using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using BankStatementAnalytics.Services;
using Common.Framework.Auth;
using Common.Framework.Logging;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BankStatementAnalytics.Controllers.Api
{
    /// <summary>
    /// Whole-instance backup and restore. Admin-only and deliberately not tenant-scoped: a backup
    /// contains every user's data (including password hashes) and a restore replaces all of it, so
    /// this is an operator action rather than something a regular user can reach.
    /// </summary>
    [ApiController]
    [Route("api/backup")]
    [Authorize(Roles = nameof(AppRole.Admin))]
    public class BackupApiController : ControllerBase
    {
        private readonly BackupService _backup;

        public BackupApiController(BackupService backup)
        {
            _backup = backup;
        }

        // GET: api/backup/status
        // Whether backup is available here, plus the sizes the UI shows before you download.
        [HttpGet("status")]
        public IActionResult GetStatus()
        {
            try
            {
                return Ok(_backup.GetStatus());
            }
            catch (Exception ex)
            {
                Log.Exception(ex);
                return StatusCode(500, new { message = "Could not read backup status." });
            }
        }

        // GET: api/backup/download
        // Streams a fresh backup zip. Built into a temp file first (pg_dump needs a real file, and
        // a complete file is what lets the response carry a Content-Length), then handed to the
        // client with DeleteOnClose so it goes away once the response has been written.
        [HttpGet("download")]
        public async Task<IActionResult> Download(CancellationToken ct)
        {
            var zipPath = Path.Combine(Path.GetTempPath(), $"bsa_backup_{Guid.NewGuid():N}.zip");
            try
            {
                await _backup.CreateBackupAsync(zipPath, ct);

                var stream = new FileStream(
                    zipPath, FileMode.Open, FileAccess.Read, FileShare.Read,
                    bufferSize: 64 * 1024,
                    options: FileOptions.Asynchronous | FileOptions.DeleteOnClose);

                var fileName = $"BankStatementAnalytics-backup-{DateTime.Now:yyyyMMdd-HHmmss}.zip";
                return File(stream, "application/zip", fileName);
            }
            catch (BackupService.BackupNotSupportedException ex)
            {
                TryDelete(zipPath);
                return BadRequest(new { message = ex.Message });
            }
            catch (OperationCanceledException)
            {
                TryDelete(zipPath);
                throw; // client went away - nothing to report
            }
            catch (Exception ex)
            {
                TryDelete(zipPath);
                Log.Exception(ex);
                return StatusCode(500, new { message = "Could not create the backup. See the log for details." });
            }
        }

        // POST: api/backup/restore  (multipart/form-data, field "file")
        // Replaces the database and the stored statement files with the contents of the zip.
        // A pre-restore snapshot of the current state is written to Data\Backups first.
        [HttpPost("restore")]
        [DisableRequestSizeLimit]
        [RequestFormLimits(MultipartBodyLengthLimit = long.MaxValue)]
        public async Task<IActionResult> Restore(IFormFile file, CancellationToken ct)
        {
            if (file == null || file.Length == 0)
                return BadRequest(new { message = "No backup file was uploaded." });

            // Buffered to disk rather than memory: a backup is as big as the whole instance.
            var zipPath = Path.Combine(Path.GetTempPath(), $"bsa_upload_{Guid.NewGuid():N}.zip");
            try
            {
                await using (var target = new FileStream(zipPath, FileMode.Create, FileAccess.Write, FileShare.None))
                    await file.CopyToAsync(target, ct);

                var result = await _backup.RestoreAsync(zipPath, ct);
                return Ok(new
                {
                    message = "Restore complete.",
                    backupCreatedUtc = result.BackupCreatedUtc,
                    uploadFileCount = result.UploadFileCount,
                    safetyBackupPath = result.SafetyBackupPath,
                });
            }
            catch (BackupService.BackupNotSupportedException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
            catch (Exception ex)
            {
                Log.Exception(ex);
                // The database restore runs in a single transaction, so a failure there leaves the
                // existing data untouched; a pre-restore snapshot is in Data\Backups either way.
                return StatusCode(500, new { message = "The restore failed. Your existing data was left in place - see the log for details." });
            }
            finally
            {
                TryDelete(zipPath);
            }
        }

        private static void TryDelete(string path)
        {
            try { if (System.IO.File.Exists(path)) System.IO.File.Delete(path); } catch { /* best effort */ }
        }
    }
}
