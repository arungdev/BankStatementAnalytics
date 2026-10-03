using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using BankStatementAnalytics.Models;
using NHibernate;
using NHibernate.Linq;

namespace BankStatementAnalytics.Services
{
    public static class SplitGroupHelper
    {
        public readonly record struct TransactionKey(long AccountId, string BankReference, string BankType);

        /// <summary>
        /// Retrieves the bank reference keys of all credit transactions that represent
        /// confirmed repayments in a Split Group (reimbursements, not real income).
        /// </summary>
        public static async Task<HashSet<TransactionKey>> GetSettledRepaymentKeysAsync(
            NHibernate.ISession session,
            IEnumerable<long> accountIds)
        {
            var ids = accountIds as IList<long> ?? accountIds.ToList();
            if (ids.Count == 0) return new HashSet<TransactionKey>();

            var members = await session.Query<SplitGroupMember>()
                .Where(m => m.LinkedAccountId != null
                         && ids.Contains(m.LinkedAccountId.Value)
                         && m.LinkedBankReference != null
                         && m.IsSettled)
                .Select(m => new { m.LinkedAccountId, m.LinkedBankReference, m.LinkedBankType })
                .ToListAsync();

            return members
                .Select(m => new TransactionKey(m.LinkedAccountId!.Value, m.LinkedBankReference!, m.LinkedBankType ?? string.Empty))
                .ToHashSet();
        }

        /// <summary>
        /// Retrieves the net spend offsets (recovered amounts) for parent bill transactions.
        /// When a user pays a ₹1,200 bill and recovers ₹900 from friends, this returns an offset of ₹900.
        /// </summary>
        public static async Task<Dictionary<TransactionKey, decimal>> GetParentBillOffsetsAsync(
            NHibernate.ISession session,
            IEnumerable<long> accountIds)
        {
            var ids = accountIds as IList<long> ?? accountIds.ToList();
            if (ids.Count == 0) return new Dictionary<TransactionKey, decimal>();

            var groups = await session.Query<SplitGroup>()
                .Where(g => g.ParentAccountId != null
                         && ids.Contains(g.ParentAccountId.Value)
                         && g.ParentBankReference != null
                         && g.SettledAmount > 0)
                .Select(g => new { g.ParentAccountId, g.ParentBankReference, g.ParentBankType, g.SettledAmount })
                .ToListAsync();

            var dict = new Dictionary<TransactionKey, decimal>();
            foreach (var g in groups)
            {
                var key = new TransactionKey(g.ParentAccountId!.Value, g.ParentBankReference!, g.ParentBankType ?? string.Empty);
                if (!dict.ContainsKey(key))
                {
                    dict[key] = g.SettledAmount;
                }
                else
                {
                    dict[key] += g.SettledAmount;
                }
            }

            return dict;
        }

        /// <summary>
        /// Calculates the net expense of a transaction after deducting settled repayments from friends.
        /// </summary>
        public static decimal GetNetSpend(
            long accountId,
            string bankReference,
            string bankType,
            decimal grossDebit,
            Dictionary<TransactionKey, decimal> offsets)
        {
            var key = new TransactionKey(accountId, bankReference, bankType ?? string.Empty);
            if (offsets.TryGetValue(key, out var recoveredAmount))
            {
                return Math.Max(0m, grossDebit - recoveredAmount);
            }
            return grossDebit;
        }
    }
}
