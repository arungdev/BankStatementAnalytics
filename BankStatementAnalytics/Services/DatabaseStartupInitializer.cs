using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;

namespace BankStatementAnalytics.Services
{
    /// <summary>
    /// Forces NHibernate (and, with it, the embedded PostgreSQL instance) to initialize during
    /// host startup.
    /// <para>
    /// This deliberately runs as a hosted service rather than inline in Program.cs before
    /// <c>app.Run()</c>. When the app runs as a Windows service, the process must connect to the
    /// Service Control Manager within 30 seconds of being launched or the SCM kills it (event
    /// 7009, "a timeout was reached while waiting for the service to connect"). That connection
    /// only happens inside <c>app.Run()</c> - so any long work placed before it runs against the
    /// SCM's clock, and a first run that has to initdb a fresh PostgreSQL cluster (~30s+) loses
    /// that race and gets killed part-way through creating the database.
    /// </para>
    /// <para>
    /// <see cref="IHostedLifecycleService.StartingAsync"/> runs after the host lifetime has
    /// connected to the SCM but before any hosted service starts - including the one that binds
    /// Kestrel - so initialization is still complete before the first request can arrive, without
    /// being on the SCM's timer.
    /// </para>
    /// </summary>
    public sealed class DatabaseStartupInitializer : IHostedLifecycleService
    {
        public Task StartingAsync(CancellationToken cancellationToken)
        {
            _ = NHibernateHelper.SessionFactory;
            return Task.CompletedTask;
        }

        public Task StartAsync(CancellationToken cancellationToken) => Task.CompletedTask;
        public Task StartedAsync(CancellationToken cancellationToken) => Task.CompletedTask;
        public Task StoppingAsync(CancellationToken cancellationToken) => Task.CompletedTask;
        public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
        public Task StoppedAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    }
}
