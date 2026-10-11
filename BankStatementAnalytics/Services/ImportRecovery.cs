using BankStatementAnalytics.Models;
using Common.Framework.Data;
using Common.Framework.Logging;
using NHibernate.Linq;

namespace BankStatementAnalytics.Services;

public static class ImportRecovery
{
    // Runs before Kestrel and the folder watcher start. Financial rows and
    // Complete are committed together, so Pending never contains committed rows.
    public static void RecoverPending()
    {
        using var session = DbHelper.GetSession();
        var pending = session.Query<Upload>().Where(u => u.ImportStatus == "Pending" || u.ImportStatus == "Deleting").ToList();
        foreach (var upload in pending)
        {
            UploadStorage.DeleteFile(upload.StoredName);
            using var transaction = session.BeginTransaction();
            if (upload.TransactionId.HasValue)
            {
                var record = session.Get<UploadTransaction>(upload.TransactionId.Value);
                if (record != null) session.Delete(record);
            }
            session.Delete(upload);
            transaction.Commit();
            Log.Info($"Recovered interrupted statement import {upload.Id}.");
        }
    }

    public static void ProtectLegacyPasswords(StatementPasswordProtector protector)
    {
        using var session = DbHelper.GetSession();
        using var transaction = session.BeginTransaction();
        foreach (var account in session.Query<Account>().Where(a => a.StatementPassword != null).ToList())
            if (!string.IsNullOrEmpty(account.StatementPassword) && !protector.IsProtected(account.StatementPassword))
                account.StatementPassword = protector.Protect(account.StatementPassword);
        transaction.Commit();
    }
}
