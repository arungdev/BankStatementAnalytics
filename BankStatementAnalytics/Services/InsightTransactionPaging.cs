using BankStatementAnalytics.Models;
using NHibernate.Linq;

namespace BankStatementAnalytics.Services;

public static class InsightTransactionPaging
{
    public static async Task<object> ReadAsync(NHibernate.ISession session, IQueryable<BankTransaction> query,
        string groupBy, string groupValue, int page, int pageSize)
    {
        var isCategory = groupBy == "byCategory";
        if (groupBy == "byTag") {
            query = query.Where(t => t.Tags != null &&
                ("," + t.Tags.Replace(", ", ",") + ",").Contains("," + groupValue + ","));
        }
        var splitQuery = session.Query<TransactionSplit>();
        var categoryName = groupValue.ToLowerInvariant();
        if (isCategory) {
            query = query.Where(t =>
                splitQuery.Any(s => s.ParentAccountId == t.AccountId && s.ParentBankReference == t.BankReference && (s.ParentBankType ?? "") == (t.BankType ?? "") && s.Amount > 0 && (s.Category == null || s.Category.Trim() == "" ? "Uncategorized" : s.Category.Trim()).ToLower() == categoryName)
                || ((t.CategoryOverride ?? (t.CounterParty != null ? t.CounterParty.Category : null) ?? "Uncategorized").ToLower() == categoryName
                    && t.Debit > (splitQuery.Where(s => s.ParentAccountId == t.AccountId && s.ParentBankReference == t.BankReference && (s.ParentBankType ?? "") == (t.BankType ?? "") && s.Amount > 0).Select(s => (decimal?)s.Amount).Sum() ?? 0)));
        }
        pageSize = Math.Clamp(pageSize, 1, 100);
        var totalCount = await query.CountAsync();
        page = Math.Clamp(page, 1, Math.Max(1, (totalCount + pageSize - 1) / pageSize));
        var totalAmount = isCategory
            ? await query.Select(t => (decimal?)(
                (splitQuery.Where(s => s.ParentAccountId == t.AccountId && s.ParentBankReference == t.BankReference && (s.ParentBankType ?? "") == (t.BankType ?? "") && s.Amount > 0 && (s.Category == null || s.Category.Trim() == "" ? "Uncategorized" : s.Category.Trim()).ToLower() == categoryName).Select(s => (decimal?)s.Amount).Sum() ?? 0)
                + ((t.CategoryOverride ?? (t.CounterParty != null ? t.CounterParty.Category : null) ?? "Uncategorized").ToLower() == categoryName
                    ? (t.Debit > (splitQuery.Where(s => s.ParentAccountId == t.AccountId && s.ParentBankReference == t.BankReference && (s.ParentBankType ?? "") == (t.BankType ?? "") && s.Amount > 0).Select(s => (decimal?)s.Amount).Sum() ?? 0)
                        ? t.Debit - (splitQuery.Where(s => s.ParentAccountId == t.AccountId && s.ParentBankReference == t.BankReference && (s.ParentBankType ?? "") == (t.BankType ?? "") && s.Amount > 0).Select(s => (decimal?)s.Amount).Sum() ?? 0) : 0) : 0))).SumAsync() ?? 0
            : await query.Select(t => (decimal?)t.Debit).SumAsync() ?? 0;
        var projected = query
            .OrderByDescending(t => t.TransactionDate)
            .ThenBy(t => t.AccountId).ThenBy(t => t.BankType).ThenBy(t => t.BankReference)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(t => new
            {
                id = t.BankReference,
                bankType = t.BankType,
                date = t.TransactionDate,
                description = t.CounterParty != null ? t.CounterParty.Name : t.BankReference,
                accountId = t.AccountId,
                amount = t.Debit,
                tags = t.Tags,
                categoryOverride = t.CategoryOverride,
                subCategoryOverride = t.SubCategoryOverride,
                merchantCategory = t.CounterParty != null ? t.CounterParty.Category : null
            });

        var rows = await projected.ToListAsync();

        if (isCategory)
        {
            var splitsLookup = await TransactionSplitHelper.GetPageSplitsAsync(session,
                rows.Select(r => new TransactionSplitHelper.SplitParentKey(r.accountId, r.id, r.bankType ?? "")));
            var categoryRows = rows.Select(r =>
            {
                var expanded = TransactionSplitHelper.ExpandSpend(
                    r.accountId,
                    r.id,
                    r.bankType,
                    r.amount,
                    r.categoryOverride ?? r.merchantCategory ?? "Uncategorized",
                    r.subCategoryOverride,
                    splitsLookup);

                var matching = expanded.Where(e => string.Equals(e.Category, groupValue, StringComparison.OrdinalIgnoreCase)).ToList();
                return new { r.id, r.date, r.accountId, description = matching.Any(e => e.IsSplit) ? $"{r.description} (Split: {groupValue})" : r.description, amount = matching.Sum(e => e.Amount) };
            }).ToList();

            return new { items = categoryRows, totalCount, page, pageSize, totalAmount };
        }

        var result = rows.Select(t => new { t.id, t.date, t.description, t.accountId, t.amount });

        return new { items = result.ToList(), totalCount, page, pageSize, totalAmount };
    }
}
