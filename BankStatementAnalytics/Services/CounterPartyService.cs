// Services/CounterPartyService.cs
using Common.Framework.Data;
using BankStatementAnalytics.Models;
using ISession = NHibernate.ISession;

namespace BankStatementAnalytics.Services
{
    public class CounterPartyService
    {
        /// <summary>
        /// Resolves (or creates) the merchant for a single counterparty in its own transaction.
        /// Kept for one-off callers; the import path uses <see cref="ResolveOrCreateBatch"/>.
        /// </summary>
        public Merchant ResolveOrCreate(
            string name,
            string? bankCode,
            long accountId,
            string? upiId = null)
        {
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var ownerUserId = session.Get<Account>(accountId)?.OwnerUserId;
            var merchant = ResolveOrCreateCore(session, ownerUserId, name, bankCode, accountId, upiId);

            tx.Commit();
            return merchant;
        }

        /// <summary>
        /// Resolves every transaction's <see cref="BankTransaction.PendingCounterPartyName"/> to a
        /// Merchant in a single session/transaction, caching by counterparty so a statement with many
        /// rows to the same merchant issues one lookup instead of one per row (previously each parser
        /// opened a session+transaction per transaction).
        /// </summary>
        public void ResolveOrCreateBatch(long accountId, IReadOnlyCollection<BankTransaction> transactions)
        {
            var pending = transactions
                .Where(t => !string.IsNullOrWhiteSpace(t.PendingCounterPartyName))
                .ToList();
            if (pending.Count == 0)
                return;

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var ownerUserId = session.Get<Account>(accountId)?.OwnerUserId;

            // Cache resolved merchants within this batch so repeat counterparties don't re-query.
            var cache = new Dictionary<string, Merchant>(StringComparer.Ordinal);

            foreach (var t in pending)
            {
                var name = t.PendingCounterPartyName!;
                var upiId = t.UpiVpa;
                var bankCode = t.BankCode;

                var cacheKey = !string.IsNullOrWhiteSpace(upiId) ? "U:" + upiId : $"N:{name}|{bankCode}";

                if (cache.TryGetValue(cacheKey, out var merchant))
                {
                    // Already resolved this counterparty in the batch — just record the account/UPI.
                    TrackAccountAndUpi(session, merchant, accountId, upiId);
                }
                else
                {
                    merchant = ResolveOrCreateCore(session, ownerUserId, name, bankCode, accountId, upiId);
                    cache[cacheKey] = merchant;
                }

                t.CounterParty = merchant;
            }

            tx.Commit();
        }

        // ── Shared resolution logic (no session/transaction management) ───────────
        private static Merchant ResolveOrCreateCore(
            ISession session, long? ownerUserId, string name, string? bankCode, long accountId, string? upiId)
        {
            Merchant? found = null;

            // ── 1. Try match by UPI ID ───────────────────────────────────────
            if (!string.IsNullOrWhiteSpace(upiId))
            {
                found = session.Query<MerchantUpi>()
                    .Where(u => u.UpiId == upiId && u.CounterParty.OwnerUserId == ownerUserId)
                    .Select(u => u.CounterParty)
                    .FirstOrDefault();
            }

            // ── 2. Match by primary Name (+ bank code) or a previously merged alias ──
            if (found == null)
            {
                found = session.Query<Merchant>()
                    .FirstOrDefault(x => x.OwnerUserId == ownerUserId &&
                        ((x.Name == name && x.BankCode == bankCode) || x.Aliases.Contains(name)));
            }

            // ── 3. Create new ────────────────────────────────────────────────
            if (found == null)
            {
                found = new Merchant
                {
                    Name = name,
                    BankCode = bankCode,
                    OwnerUserId = ownerUserId,
                    CreatedOn = DateTime.Now,
                };
                session.Save(found);
            }

            TrackAccountAndUpi(session, found, accountId, upiId);
            return found;
        }

        // Track which account this merchant was funded from, and register a new UPI id.
        private static void TrackAccountAndUpi(ISession session, Merchant merchant, long accountId, string? upiId)
        {
            if (!merchant.AccountIds.Contains(accountId))
                merchant.AccountIds.Add(accountId);

            if (!string.IsNullOrWhiteSpace(upiId) && !merchant.UpiIds.Any(u => u.UpiId == upiId))
            {
                var newUpi = new MerchantUpi
                {
                    CounterParty = merchant,
                    UpiId = upiId,
                    CreatedOn = DateTime.Now,
                };
                merchant.UpiIds.Add(newUpi);
                session.Save(newUpi);
            }
        }
    }
}
