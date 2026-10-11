namespace BankStatementAnalytics.Services;

/// <summary>Serialize manual and watched imports per account, including SQLite.</summary>
public static class ImportAccountGate
{
    private sealed class Entry { public readonly SemaphoreSlim Semaphore = new(1, 1); public int Users; }
    private static readonly Dictionary<long, Entry> Entries = new();
    private static readonly object Sync = new();

    public static async Task<IDisposable> AcquireAsync(long accountId)
    {
        Entry entry;
        lock (Sync)
        {
            if (!Entries.TryGetValue(accountId, out entry!)) Entries[accountId] = entry = new Entry();
            entry.Users++;
        }
        await entry.Semaphore.WaitAsync();
        return new Lease(accountId, entry);
    }

    private sealed class Lease(long accountId, Entry entry) : IDisposable
    {
        private int _disposed;
        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
            entry.Semaphore.Release();
            lock (Sync)
            {
                if (--entry.Users == 0) { Entries.Remove(accountId); entry.Semaphore.Dispose(); }
            }
        }
    }
}
