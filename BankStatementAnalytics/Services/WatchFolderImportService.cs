using BankStatementAnalytics.Models;
using Common.Framework.Data;
using Common.Framework.Logging;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace BankStatementAnalytics.Services
{
    /// <summary>
    /// Sweeps each account's configured watch folder (Account.WatchFolderPath)
    /// about once a minute and imports new statement files through the same
    /// pipeline as a manual upload. Poll-based on purpose — a plain sweep
    /// survives service restarts, offline network drives, and files dropped
    /// while the service was stopped, which FileSystemWatcher alone does not.
    /// </summary>
    public class WatchFolderImportService : BackgroundService
    {
        private static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(15);
        private static readonly TimeSpan SweepInterval = TimeSpan.FromSeconds(60);

        private readonly IServiceScopeFactory _scopeFactory;

        // Released by TriggerSweep to cut the between-sweep wait short ("Import now").
        private readonly SemaphoreSlim _wake = new(0, 1);

        // (accountId, path, lastWriteUtc, length) tuples already handled — imported,
        // recognized as duplicates, or failed. A file edit changes the key, so
        // modified files get retried; everything retries after a service restart.
        // Guarded by _handledLock: request threads call ForgetAccount on revert.
        private readonly HashSet<(long, string, DateTime, long)> _handled = new();
        private readonly object _handledLock = new();

        // Folders already reported missing, so an offline drive logs once, not every sweep.
        private readonly HashSet<string> _reportedMissing = new(StringComparer.OrdinalIgnoreCase);

        public WatchFolderImportService(IServiceScopeFactory scopeFactory)
        {
            _scopeFactory = scopeFactory;
        }

        /// <summary>Ask the loop to run its next sweep immediately instead of waiting out the interval.</summary>
        public void TriggerSweep()
        {
            try { _wake.Release(); }
            catch (SemaphoreFullException) { /* a sweep is already queued */ }
        }

        /// <summary>
        /// Drop the account's handled-file memory so a reverted upload's source file
        /// is picked up again on the next sweep instead of waiting for a restart.
        /// </summary>
        public void ForgetAccount(long accountId)
        {
            lock (_handledLock)
                _handled.RemoveWhere(k => k.Item1 == accountId);
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            // Let NHibernate / embedded Postgres finish initializing.
            try { await Task.Delay(StartupDelay, stoppingToken); }
            catch (OperationCanceledException) { return; }

            Log.Info("Watch-folder auto-import started.");

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await SweepAsync(stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    // One bad sweep must never kill the loop.
                    Log.Exception(ex);
                }

                // Waits out the interval, but returns early when TriggerSweep releases the semaphore.
                try { await _wake.WaitAsync(SweepInterval, stoppingToken); }
                catch (OperationCanceledException) { break; }
            }
        }

        private async Task SweepAsync(CancellationToken stoppingToken)
        {
            var accounts = (await DbHelper.QueryAsync<Account>(
                    a => a.WatchFolderPath != null && a.WatchFolderPath != ""))
                .Where(a => a.WatchEnabled != false)   // null == enabled (pre-flag rows)
                .ToList();

            foreach (var account in accounts)
            {
                stoppingToken.ThrowIfCancellationRequested();

                var folder = account.WatchFolderPath!;
                if (!Directory.Exists(folder))
                {
                    if (_reportedMissing.Add(folder))
                        Log.Info($"Watch folder not accessible, skipping until it returns: {folder}");
                    continue;
                }
                _reportedMissing.Remove(folder);

                var (formats, _) = TextService.GetSupportedFormats(account.BankName);
                var allowed = new HashSet<string>(
                    formats.Length > 0 ? formats : new[] { ".txt" },
                    StringComparer.OrdinalIgnoreCase);

                List<string> files;
                try
                {
                    files = Directory.EnumerateFiles(folder)
                        .Where(f => allowed.Contains(Path.GetExtension(f)))
                        .OrderBy(f => f, StringComparer.OrdinalIgnoreCase)
                        .ToList();
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    Log.Error($"Failed to enumerate watch folder {folder}", ex);
                    continue;
                }

                foreach (var file in files)
                {
                    stoppingToken.ThrowIfCancellationRequested();
                    await ImportFileAsync(account, file);
                }
            }
        }

        private async Task ImportFileAsync(Account account, string file)
        {
            (long, string, DateTime, long) key;
            byte[] bytes;
            try
            {
                var info = new FileInfo(file);
                key = (account.Id, file, info.LastWriteTimeUtc, info.Length);
                lock (_handledLock)
                {
                    if (_handled.Contains(key))
                        return;
                }

                // A file still being written/downloaded is opened exclusively by its
                // writer; leave it for the next sweep instead of importing half a file.
                using (var probe = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.None))
                {
                    bytes = new byte[probe.Length];
                    await probe.ReadExactlyAsync(bytes);
                }
            }
            catch (IOException)
            {
                return; // locked or vanished mid-sweep — retry next time
            }
            catch (UnauthorizedAccessException ex)
            {
                Log.Error($"No read access to {file}", ex);
                return;
            }

            try
            {
                using var scope = _scopeFactory.CreateScope();
                var importer = scope.ServiceProvider.GetRequiredService<StatementImportService>();
                var result = await importer.ImportAsync(
                    account, bytes, Path.GetFileName(file), account.StatementPassword, autoImported: true);

                switch (result.Outcome)
                {
                    case ImportOutcome.Success:
                        Log.Info($"Auto-imported {file} for account {account.Id}: {result.NewCount} new of {result.Total} transactions.");
                        await RecordHistoryAsync(account, file, "Success", null, result.Upload!.Id);
                        break;
                    case ImportOutcome.Duplicate:
                        // Normal: the file was imported on an earlier sweep or uploaded manually.
                        break;
                    case ImportOutcome.InvalidFile:
                        Log.Error($"Auto-import skipped {file} for account {account.Id}: {result.Error}");
                        await RecordHistoryAsync(account, file, "Failed", result.Error, null);
                        break;
                }
            }
            catch (Exception ex)
            {
                Log.Error($"Auto-import failed for {file} (account {account.Id})", ex);
                await RecordHistoryAsync(account, file, "Failed", ex.Message, null);
            }

            // Handled either way — success, duplicate, or failure. Failures are not
            // retried every sweep; a restart, a change to the file, or a revert
            // (ForgetAccount) retries.
            lock (_handledLock)
                _handled.Add(key);
        }

        private static async Task RecordHistoryAsync(Account account, string file, string status, string? error, Guid? uploadId)
        {
            try
            {
                await DbHelper.SaveAsync(new ImportHistory
                {
                    Id = Guid.NewGuid(),
                    AccountId = (int)account.Id,
                    FileName = Path.GetFileName(file),
                    SourcePath = file,
                    Status = status,
                    Error = error?.Length > 2000 ? error[..2000] : error,
                    CreatedAt = DateTime.UtcNow,
                    UploadId = uploadId
                });
            }
            catch (Exception ex)
            {
                // History is best-effort; never let it break the sweep.
                Log.Exception(ex);
            }
        }
    }
}
