using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using NHibernate;
using NHibernate.Linq;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Services
{
    public static class TransactionSplitHelper
    {
        public readonly record struct SplitParentKey(long AccountId, string BankReference, string BankType);

        public class SplitSpendItem
        {
            public long AccountId { get; set; }
            public string BankReference { get; set; } = string.Empty;
            public string BankType { get; set; } = string.Empty;
            public string Category { get; set; } = "Uncategorized";
            public string? SubCategory { get; set; }
            public decimal Amount { get; set; }
            public bool IsSplit { get; set; }
            public string? Note { get; set; }
        }

        public static async Task<ILookup<SplitParentKey, TransactionSplit>> GetSplitsLookupAsync(
            NHibernate.ISession session,
            IEnumerable<long> accountIds)
        {
            var ids = accountIds as IList<long> ?? accountIds.ToList();
            if (ids.Count == 0)
                return Enumerable.Empty<TransactionSplit>().ToLookup(x => new SplitParentKey(0, string.Empty, string.Empty));

            var splits = await session.Query<TransactionSplit>()
                .Where(s => ids.Contains(s.ParentAccountId))
                .ToListAsync();

            return splits.ToLookup(s => new SplitParentKey(s.ParentAccountId, s.ParentBankReference, s.ParentBankType ?? string.Empty));
        }

        public static async Task<ILookup<SplitParentKey, TransactionSplit>> GetSplitsLookupAsync(
            NHibernate.ISession session,
            long accountId)
        {
            return await GetSplitsLookupAsync(session, new[] { accountId });
        }

        public static IEnumerable<SplitSpendItem> ExpandSpend(
            long accountId,
            string bankReference,
            string bankType,
            decimal debit,
            string defaultCategory,
            string? defaultSubCategory,
            ILookup<SplitParentKey, TransactionSplit> splitsLookup)
        {
            var key = new SplitParentKey(accountId, bankReference, bankType ?? string.Empty);
            var splits = splitsLookup[key].ToList();

            if (splits.Count == 0)
            {
                yield return new SplitSpendItem
                {
                    AccountId = accountId,
                    BankReference = bankReference,
                    BankType = bankType ?? string.Empty,
                    Category = string.IsNullOrWhiteSpace(defaultCategory) ? "Uncategorized" : defaultCategory.Trim(),
                    SubCategory = defaultSubCategory,
                    Amount = debit,
                    IsSplit = false,
                };
                yield break;
            }

            decimal splitSum = 0m;
            foreach (var s in splits)
            {
                if (s.Amount <= 0) continue;
                splitSum += s.Amount;
                yield return new SplitSpendItem
                {
                    AccountId = accountId,
                    BankReference = bankReference,
                    BankType = bankType ?? string.Empty,
                    Category = string.IsNullOrWhiteSpace(s.Category) ? "Uncategorized" : s.Category.Trim(),
                    SubCategory = s.SubCategory,
                    Amount = s.Amount,
                    IsSplit = true,
                    Note = s.Note
                };
            }

            // If splits do not cover full debit, remaining portion remains in default category
            if (debit > splitSum)
            {
                yield return new SplitSpendItem
                {
                    AccountId = accountId,
                    BankReference = bankReference,
                    BankType = bankType ?? string.Empty,
                    Category = string.IsNullOrWhiteSpace(defaultCategory) ? "Uncategorized" : defaultCategory.Trim(),
                    SubCategory = defaultSubCategory,
                    Amount = debit - splitSum,
                    IsSplit = false,
                };
            }
        }
    }
}
