using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Common.Framework.Data;
using Common.Framework.Logging;
using Npgsql;

namespace BankStatementAnalytics.Services
{
    /// <summary>
    /// Whole-instance backup and restore: the entire PostgreSQL database (pg_dump custom format)
    /// plus the Uploads/ tree of original statement files, in one zip.
    ///
    /// This is deliberately an instance-wide operation, not a per-user one - the dump covers every
    /// user's accounts, transactions and password hashes, and a restore replaces all of it. The API
    /// on top of this is therefore Admin-only (see BackupApiController).
    ///
    /// Postgres only. The SQLite fallback path (see <see cref="NHibernateHelper"/>) can't be
    /// restored while the app holds the file open, so rather than ship a backup that can't be
    /// restored, both operations refuse with an explanation - see <see cref="DescribeSupport"/>.
    /// </summary>
    public sealed class BackupService
    {
        /// <summary>Bumped when the zip layout changes. A backup from a newer app is refused.</summary>
        public const int FormatVersion = 1;

        private const string ManifestEntry = "manifest.json";
        private const string DumpEntry = "database.dump";
        private const string UploadsPrefix = "uploads/";

        // pg_dump/pg_restore can run for a while on a large database; well past any HTTP timeout
        // is fine, this is bounded only to stop a wedged child process hanging the request forever.
        private static readonly TimeSpan ToolTimeout = TimeSpan.FromMinutes(30);

        private static readonly JsonSerializerOptions ManifestJson = new() { WriteIndented = true };

        /// <summary>What the UI needs to decide whether to offer backup, and to size the download.</summary>
        public sealed record BackupStatus(
            bool Supported,
            string? Reason,
            long DatabaseBytes,
            int UploadFileCount,
            long UploadBytes);

        /// <summary>Contents of manifest.json - identifies the zip and what it came from.</summary>
        public sealed record BackupManifest(
            int FormatVersion,
            DateTime CreatedUtc,
            string? AppVersion,
            string Provider,
            int UploadFileCount,
            long UploadBytes);

        public sealed record RestoreResult(DateTime BackupCreatedUtc, int UploadFileCount, string SafetyBackupPath);

        /// <summary>Raised for every condition the caller should report as a 400, not a 500.</summary>
        public sealed class BackupNotSupportedException : Exception
        {
            public BackupNotSupportedException(string message) : base(message) { }
        }

        // ── Support / status ─────────────────────────────────────────────────

        /// <summary>Null when backup is available, otherwise the reason it isn't.</summary>
        private static string? DescribeSupport(DatabaseInfo db)
        {
            if (!db.IsPostgres)
                return "Backup and restore need the PostgreSQL provider. This app is running on the SQLite fallback.";
            if (string.IsNullOrWhiteSpace(db.ConnectionString))
                return "No PostgreSQL connection string is configured.";
            if (FindTool(db, "pg_dump") == null || FindTool(db, "pg_restore") == null)
                return "The PostgreSQL command-line tools (pg_dump / pg_restore) were not found next to the app or on PATH.";
            return null;
        }

        public BackupStatus GetStatus()
        {
            var db = NHibernateHelper.Describe();
            var reason = DescribeSupport(db);

            var (fileCount, uploadBytes) = MeasureUploads();

            long dbBytes = 0;
            if (reason == null)
            {
                try
                {
                    using var session = DbHelper.GetSession();
                    dbBytes = Convert.ToInt64(session
                        .CreateSQLQuery("select pg_database_size(current_database())")
                        .UniqueResult());
                }
                catch (Exception ex)
                {
                    // Only used to show an approximate size - never worth failing the page over.
                    Log.Info($"BackupService: could not read database size ({ex.Message}).");
                }
            }

            return new BackupStatus(reason == null, reason, dbBytes, fileCount, uploadBytes);
        }

        private static (int Count, long Bytes) MeasureUploads()
        {
            var root = UploadStorage.Root;
            if (!Directory.Exists(root))
                return (0, 0);

            var files = Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories).ToList();
            return (files.Count, files.Sum(f => new FileInfo(f).Length));
        }

        // ── Backup ───────────────────────────────────────────────────────────

        /// <summary>
        /// Writes a complete backup zip and returns its path. The file is written to the caller's
        /// chosen folder (a temp path for a download, Data\Backups for the pre-restore safety copy)
        /// and is the caller's to delete.
        /// </summary>
        public async Task<string> CreateBackupAsync(string zipPath, CancellationToken ct = default)
        {
            var db = NHibernateHelper.Describe();
            var reason = DescribeSupport(db);
            if (reason != null)
                throw new BackupNotSupportedException(reason);

            var dumpPath = Path.Combine(Path.GetTempPath(), $"bsa_dump_{Guid.NewGuid():N}.dump");
            try
            {
                await RunToolAsync(db, "pg_dump", new[]
                {
                    "--format=custom",
                    // The restore target owns its own roles; keeping ownership/ACLs out of the dump
                    // is what lets a backup be restored into a differently-provisioned instance.
                    "--no-owner",
                    "--no-privileges",
                    "--file", dumpPath,
                }, ct);

                var (fileCount, uploadBytes) = MeasureUploads();
                var manifest = new BackupManifest(
                    FormatVersion,
                    DateTime.UtcNow,
                    typeof(BackupService).Assembly.GetName().Version?.ToString(),
                    db.IsEmbedded ? "PostgresEmbedded" : "Postgres",
                    fileCount,
                    uploadBytes);

                Directory.CreateDirectory(Path.GetDirectoryName(zipPath)!);
                using (var zipStream = new FileStream(zipPath, FileMode.Create, FileAccess.Write, FileShare.None))
                using (var zip = new ZipArchive(zipStream, ZipArchiveMode.Create))
                {
                    var manifestEntry = zip.CreateEntry(ManifestEntry, CompressionLevel.Optimal);
                    await using (var writer = new StreamWriter(manifestEntry.Open()))
                        await writer.WriteAsync(JsonSerializer.Serialize(manifest, ManifestJson));

                    // Already compressed by pg_dump's custom format - re-deflating it costs
                    // CPU and time for essentially nothing.
                    zip.CreateEntryFromFile(dumpPath, DumpEntry, CompressionLevel.NoCompression);

                    var root = UploadStorage.Root;
                    if (Directory.Exists(root))
                    {
                        foreach (var file in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
                        {
                            ct.ThrowIfCancellationRequested();
                            var relative = Path.GetRelativePath(root, file).Replace('\\', '/');
                            zip.CreateEntryFromFile(file, UploadsPrefix + relative, CompressionLevel.Optimal);
                        }
                    }
                }

                Log.Info($"BackupService: wrote backup '{zipPath}' ({new FileInfo(zipPath).Length} bytes, {fileCount} upload file(s)).");
                return zipPath;
            }
            finally
            {
                TryDelete(dumpPath);
            }
        }

        // ── Restore ──────────────────────────────────────────────────────────

        /// <summary>
        /// Replaces the database and the Uploads tree with the contents of a backup zip.
        ///
        /// Order matters: the zip is fully validated, then a pre-restore safety backup of the
        /// CURRENT state is taken, and only then is anything overwritten - so a restore from a
        /// wrong or truncated file isn't a one-way door.
        /// </summary>
        public async Task<RestoreResult> RestoreAsync(string zipPath, CancellationToken ct = default)
        {
            var db = NHibernateHelper.Describe();
            var reason = DescribeSupport(db);
            if (reason != null)
                throw new BackupNotSupportedException(reason);

            var workDir = Path.Combine(Path.GetTempPath(), $"bsa_restore_{Guid.NewGuid():N}");
            Directory.CreateDirectory(workDir);

            try
            {
                using var zip = OpenBackup(zipPath);
                var manifest = ReadManifest(zip);

                var dumpEntry = zip.GetEntry(DumpEntry)
                    ?? throw new BackupNotSupportedException($"This zip has no {DumpEntry} - it isn't a BankStatementAnalytics backup.");

                // Extract first: a truncated zip should fail here, before the live data is touched.
                var dumpPath = Path.Combine(workDir, "database.dump");
                dumpEntry.ExtractToFile(dumpPath);

                var stagedUploads = Path.Combine(workDir, "uploads");
                var uploadCount = ExtractUploads(zip, stagedUploads);

                var safetyPath = await CreateSafetyBackupAsync(ct);

                await RunToolAsync(db, "pg_restore", new[]
                {
                    "--clean",
                    // The target database is the one NHibernate created, so the objects the dump
                    // drops may or may not exist yet (e.g. a table added since the backup).
                    "--if-exists",
                    "--no-owner",
                    "--no-privileges",
                    // All-or-nothing: a failure part-way through leaves the existing schema intact
                    // rather than a half-dropped database.
                    "--single-transaction",
                    dumpPath,
                }, ct);

                // Every pooled connection was talking to the schema that has just been dropped and
                // rebuilt. Nothing NHibernate does here survives that (no second-level cache, no
                // prepared statements), but retiring the physical connections costs one reconnect
                // and removes any question of server-side state outliving the restore.
                NpgsqlConnection.ClearAllPools();

                SwapUploads(stagedUploads);

                Log.Info($"BackupService: restored backup created {manifest.CreatedUtc:u} ({uploadCount} upload file(s)); safety copy at '{safetyPath}'.");
                return new RestoreResult(manifest.CreatedUtc, uploadCount, safetyPath);
            }
            finally
            {
                TryDeleteDirectory(workDir);
            }
        }

        private static ZipArchive OpenBackup(string zipPath)
        {
            try
            {
                return ZipFile.OpenRead(zipPath);
            }
            catch (InvalidDataException)
            {
                throw new BackupNotSupportedException("That file isn't a readable zip - it may be corrupt or only partly uploaded.");
            }
        }

        private static BackupManifest ReadManifest(ZipArchive zip)
        {
            var entry = zip.GetEntry(ManifestEntry)
                ?? throw new BackupNotSupportedException("This zip has no manifest.json - it isn't a BankStatementAnalytics backup.");

            BackupManifest? manifest;
            try
            {
                using var stream = entry.Open();
                manifest = JsonSerializer.Deserialize<BackupManifest>(stream, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            }
            catch (JsonException)
            {
                throw new BackupNotSupportedException("The manifest in this backup is unreadable.");
            }

            if (manifest == null)
                throw new BackupNotSupportedException("The manifest in this backup is empty.");

            if (manifest.FormatVersion > FormatVersion)
                throw new BackupNotSupportedException(
                    $"This backup was written by a newer version of the app (format {manifest.FormatVersion}, this app reads {FormatVersion}). Update the app first.");

            return manifest;
        }

        /// <summary>Extracts the uploads/ entries into <paramref name="targetRoot"/>, returning the file count.</summary>
        private static int ExtractUploads(ZipArchive zip, string targetRoot)
        {
            Directory.CreateDirectory(targetRoot);
            var fullRoot = Path.GetFullPath(targetRoot);
            var count = 0;

            foreach (var entry in zip.Entries)
            {
                if (!entry.FullName.StartsWith(UploadsPrefix, StringComparison.Ordinal))
                    continue;
                if (entry.FullName.EndsWith('/'))
                    continue; // directory marker

                var relative = entry.FullName[UploadsPrefix.Length..];
                var destination = Path.GetFullPath(Path.Combine(fullRoot, relative));

                // Zip-slip: an entry named ..\..\something must not escape the target folder.
                if (!destination.StartsWith(fullRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                    throw new BackupNotSupportedException($"This backup contains an unsafe file path ('{entry.FullName}') and was not restored.");

                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                entry.ExtractToFile(destination, overwrite: true);
                count++;
            }

            return count;
        }

        /// <summary>
        /// Puts the staged uploads in place of the live ones. The outgoing folder is moved aside
        /// first and only deleted once the new tree is in place, so a failure mid-swap can still
        /// be walked back by hand (and everything in it is in the safety backup regardless).
        /// </summary>
        private static void SwapUploads(string stagedUploads)
        {
            var root = UploadStorage.Root;
            var replaced = $"{root}.replaced-{DateTime.Now:yyyyMMdd-HHmmss}";

            Directory.CreateDirectory(Path.GetDirectoryName(root)!);

            if (Directory.Exists(root))
                Directory.Move(root, replaced);

            try
            {
                Directory.Move(stagedUploads, root);
            }
            catch
            {
                if (Directory.Exists(replaced) && !Directory.Exists(root))
                    Directory.Move(replaced, root);
                throw;
            }

            TryDeleteDirectory(replaced);
        }

        /// <summary>
        /// Snapshots the current state before a restore overwrites it. Kept under Data\Backups so
        /// it survives the request; the newest few are retained and older ones pruned.
        /// </summary>
        private async Task<string> CreateSafetyBackupAsync(CancellationToken ct)
        {
            var folder = Path.Combine(Common.Framework.AppPaths.ResolveWritableAppDataDirectory(), "Data", "Backups");
            Directory.CreateDirectory(folder);

            var path = Path.Combine(folder, $"pre-restore-{DateTime.Now:yyyyMMdd-HHmmss}.zip");
            await CreateBackupAsync(path, ct);

            const int keep = 5;
            foreach (var old in new DirectoryInfo(folder)
                         .GetFiles("pre-restore-*.zip")
                         .OrderByDescending(f => f.CreationTimeUtc)
                         .Skip(keep))
            {
                TryDelete(old.FullName);
            }

            return path;
        }

        // ── Running pg_dump / pg_restore ─────────────────────────────────────

        /// <summary>
        /// Locates a Postgres client tool: the bundle shipped next to the app first (that's the
        /// only copy an embedded instance has, and it always matches the server version), then
        /// PATH for deployments running against an external server (e.g. the Docker image).
        /// </summary>
        private static string? FindTool(DatabaseInfo db, string tool)
        {
            var bundled = Path.Combine(db.AppDir, "pgsql", "bin", $"{tool}.exe");
            if (File.Exists(bundled))
                return bundled;

            var pathDirs = (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator);
            var names = OperatingSystem.IsWindows() ? new[] { $"{tool}.exe" } : new[] { tool, $"{tool}.exe" };

            return pathDirs
                .Where(d => !string.IsNullOrWhiteSpace(d))
                .SelectMany(d => names.Select(n => Path.Combine(d.Trim(), n)))
                .FirstOrDefault(File.Exists);
        }

        private static async Task RunToolAsync(DatabaseInfo db, string tool, IEnumerable<string> args, CancellationToken ct)
        {
            var exe = FindTool(db, tool)
                ?? throw new BackupNotSupportedException($"{tool} was not found next to the app or on PATH.");

            var conn = new NpgsqlConnectionStringBuilder(db.ConnectionString);

            var psi = new ProcessStartInfo(exe)
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };

            psi.ArgumentList.Add("--host");
            psi.ArgumentList.Add(conn.Host ?? "127.0.0.1");
            psi.ArgumentList.Add("--port");
            psi.ArgumentList.Add(conn.Port.ToString());
            psi.ArgumentList.Add("--username");
            psi.ArgumentList.Add(conn.Username ?? "postgres");
            psi.ArgumentList.Add("--dbname");
            psi.ArgumentList.Add(conn.Database ?? "bankstatements");
            psi.ArgumentList.Add("--no-password"); // never block on an interactive prompt
            foreach (var arg in args)
                psi.ArgumentList.Add(arg);

            // The only way to hand these tools a password without a prompt or an on-disk .pgpass.
            psi.Environment["PGPASSWORD"] = conn.Password ?? "";

            using var process = Process.Start(psi)
                ?? throw new InvalidOperationException($"Could not start {tool}.");

            // Drain both pipes concurrently - reading one to completion while the other's buffer
            // fills would deadlock the child (same reason EmbeddedPostgresManager does this).
            var stdout = process.StandardOutput.ReadToEndAsync(ct);
            var stderr = process.StandardError.ReadToEndAsync(ct);

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(ToolTimeout);

            try
            {
                await process.WaitForExitAsync(timeout.Token);
            }
            catch (OperationCanceledException)
            {
                try { process.Kill(entireProcessTree: true); } catch { /* already gone */ }
                throw new BackupNotSupportedException($"{tool} did not finish within {ToolTimeout.TotalMinutes:0} minutes and was stopped.");
            }

            await Task.WhenAll(stdout, stderr);

            if (process.ExitCode != 0)
            {
                var detail = string.IsNullOrWhiteSpace(stderr.Result) ? stdout.Result : stderr.Result;
                Log.Info($"BackupService: {tool} failed (exit {process.ExitCode}): {detail}");
                throw new InvalidOperationException($"{tool} failed (exit {process.ExitCode}): {Truncate(detail, 500)}");
            }
        }

        // ── Small helpers ────────────────────────────────────────────────────

        private static string Truncate(string value, int max) =>
            string.IsNullOrEmpty(value) || value.Length <= max ? value : value[..max] + "…";

        private static void TryDelete(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); } catch { /* best effort */ }
        }

        private static void TryDeleteDirectory(string path)
        {
            try { if (Directory.Exists(path)) Directory.Delete(path, recursive: true); } catch { /* best effort */ }
        }
    }
}
