using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using BankStatementAnalytics.Models;
using Common.Framework.Data;
using ISession = NHibernate.ISession;
using NHibernate.Linq;

namespace BankStatementAnalytics.Services
{
    /// <summary>
    /// Central place for resolving which accounts the current user owns and which of a set of
    /// requested account ids are actually theirs. Replaces the copy-pasted
    /// <c>DbHelper.GetAll&lt;Account&gt;().Where(a =&gt; a.OwnerUserId == ...)</c> whole-table scans
    /// (now filtered server-side) and the duplicated comma-separated accountIds parsing across
    /// the dashboard/trends/budgets/reports/statement controllers.
    /// </summary>
    public static class AccountAccess
    {
        // ── Owned-account ids ────────────────────────────────────────────────

        /// <summary>Owned account ids, queried through an already-open session (no extra connection).</summary>
        public static List<long> OwnedIds(ISession session, long userId) =>
            session.Query<Account>()
                .Where(a => a.OwnerUserId == userId)
                .Select(a => a.Id)
                .ToList();

        /// <summary>Owned account ids as a set, through an already-open session.</summary>
        public static HashSet<long> OwnedIdSet(ISession session, long userId) =>
            OwnedIds(session, userId).ToHashSet();

        /// <summary>Owned account ids as a set, opening a short-lived session of its own.</summary>
        public static async Task<HashSet<long>> OwnedIdSetAsync(long userId)
        {
            var ids = await DbHelper.QueryAsync<Account, long>(a => a.OwnerUserId == userId, a => a.Id);
            return ids.ToHashSet();
        }

        // ── Requested-account resolution ─────────────────────────────────────

        /// <summary>
        /// Parses a comma-separated accountIds string and keeps only ids the user owns.
        /// Returns an empty list when the string is null/blank or contains no owned ids.
        /// </summary>
        public static List<long> FilterOwned(string? accountIdsCsv, HashSet<long> ownedIds)
        {
            if (string.IsNullOrWhiteSpace(accountIdsCsv))
                return new List<long>();

            return accountIdsCsv.Split(',')
                .Select(s => long.TryParse(s.Trim(), out var id) ? id : 0)
                .Where(id => id > 0 && ownedIds.Contains(id))
                .ToList();
        }

        /// <summary>Outcome of resolving the accountId / accountIds query pair against ownership.</summary>
        public enum ScopeStatus { Ok, NotFound, Empty }

        /// <summary>
        /// Resolves the (accountIds CSV | single accountId) pair the dashboard and trends endpoints
        /// share into a set of owned ids plus a status: <see cref="ScopeStatus.NotFound"/> when a
        /// single non-owned account was requested, <see cref="ScopeStatus.Empty"/> when nothing was
        /// requested, otherwise <see cref="ScopeStatus.Ok"/>.
        /// </summary>
        public static (ScopeStatus Status, List<long> Ids) ResolveScope(
            HashSet<long> ownedIds, string? accountIdsCsv, long singleAccountId)
        {
            if (!string.IsNullOrWhiteSpace(accountIdsCsv))
                return (ScopeStatus.Ok, FilterOwned(accountIdsCsv, ownedIds));

            if (singleAccountId != 0 && ownedIds.Contains(singleAccountId))
                return (ScopeStatus.Ok, new List<long> { singleAccountId });

            if (singleAccountId != 0)
                return (ScopeStatus.NotFound, new List<long>());

            return (ScopeStatus.Empty, new List<long>());
        }
    }
}
