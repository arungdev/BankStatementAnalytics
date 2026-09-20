using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using NHibernate.Linq;
using Common.Framework.Data;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Services
{
    public class RuleEngineService
    {
        public void ApplyRules(long userId, IList<BankTransaction> transactions)
        {
            if (transactions == null || transactions.Count == 0) return;

            using var session = DbHelper.GetSession();

            var rules = session.Query<CategorizationRule>()
                .Where(r => r.OwnerUserId == userId && r.Enabled)
                .OrderBy(r => r.Priority)
                .ToList();

            if (rules.Count == 0) return;

            foreach (var tx in transactions)
            {
                ApplyRulesToTransaction(tx, rules);
            }
        }

        public async Task<int> ApplyAllRulesRetroactivelyAsync(long userId)
        {
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var accountIds = AccountAccess.OwnedIds(session, userId);
            if (accountIds.Count == 0) return 0;

            var rules = await session.Query<CategorizationRule>()
                .Where(r => r.OwnerUserId == userId && r.Enabled)
                .OrderBy(r => r.Priority)
                .ToListAsync();

            if (rules.Count == 0) return 0;

            var transactions = await session.Query<BankTransaction>()
                .Where(t => accountIds.Contains(t.AccountId))
                .ToListAsync();

            int updatedCount = 0;

            foreach (var t in transactions)
            {
                var beforeCat = t.CategoryOverride;
                var beforeSub = t.SubCategoryOverride;
                var beforeTags = t.Tags;
                var beforeNote = t.Note;

                ApplyRulesToTransaction(t, rules);

                if (beforeCat != t.CategoryOverride || beforeSub != t.SubCategoryOverride || beforeTags != t.Tags || beforeNote != t.Note)
                {
                    await session.UpdateAsync(t);
                    updatedCount++;
                }
            }

            await tx.CommitAsync();
            return updatedCount;
        }

        public List<object> TestRule(long userId, CategorizationRule rule, int limit = 15)
        {
            using var session = DbHelper.GetSession();

            var accountIds = AccountAccess.OwnedIds(session, userId);
            if (accountIds.Count == 0) return new List<object>();

            var sample = session.Query<BankTransaction>()
                .Where(t => accountIds.Contains(t.AccountId))
                .OrderByDescending(t => t.TransactionDate)
                .Take(200)
                .ToList();

            var matches = sample
                .Where(t => MatchesRule(t, rule))
                .Take(limit)
                .Select(t => new
                {
                    id = t.BankReference,
                    date = t.TransactionDate.ToString("yyyy-MM-dd"),
                    description = t.Description,
                    merchant = t.CounterParty != null ? t.CounterParty.Name : null,
                    amount = t.Debit > 0 ? t.Debit : t.Credit,
                    currentCategory = t.CategoryOverride ?? (t.CounterParty != null ? t.CounterParty.Category : "Uncategorized"),
                    newCategory = rule.SetCategory ?? (t.CategoryOverride ?? (t.CounterParty != null ? t.CounterParty.Category : "Uncategorized")),
                    tags = CombineTags(t.Tags, rule.SetTags)
                })
                .Cast<object>()
                .ToList();

            return matches;
        }

        private static void ApplyRulesToTransaction(BankTransaction tx, List<CategorizationRule> rules)
        {
            foreach (var rule in rules)
            {
                if (MatchesRule(tx, rule))
                {
                    if (!string.IsNullOrWhiteSpace(rule.SetCategory))
                        tx.CategoryOverride = rule.SetCategory.Trim();

                    if (!string.IsNullOrWhiteSpace(rule.SetSubCategory))
                        tx.SubCategoryOverride = rule.SetSubCategory.Trim();

                    if (!string.IsNullOrWhiteSpace(rule.SetTags))
                        tx.Tags = CombineTags(tx.Tags, rule.SetTags);

                    if (!string.IsNullOrWhiteSpace(rule.SetNote))
                        tx.Note = rule.SetNote.Trim();

                    break; // Highest priority matching rule applies
                }
            }
        }

        private static bool MatchesRule(BankTransaction tx, CategorizationRule rule)
        {
            var narration = $"{tx.Description} {tx.Narration} {(tx.CounterParty != null ? tx.CounterParty.Name : "")}";

            // Narration contains
            if (!string.IsNullOrWhiteSpace(rule.NarrationContains))
            {
                var phrase = rule.NarrationContains.Trim();
                if (narration.IndexOf(phrase, StringComparison.OrdinalIgnoreCase) < 0)
                    return false;
            }

            // Narration regex
            if (!string.IsNullOrWhiteSpace(rule.NarrationRegex))
            {
                try
                {
                    if (!Regex.IsMatch(narration, rule.NarrationRegex.Trim(), RegexOptions.IgnoreCase))
                        return false;
                }
                catch
                {
                    // Ignore invalid regex in user input
                }
            }

            var amount = tx.Debit > 0 ? tx.Debit : tx.Credit;

            // Min amount
            if (rule.MinAmount.HasValue && amount < rule.MinAmount.Value)
                return false;

            // Max amount
            if (rule.MaxAmount.HasValue && amount > rule.MaxAmount.Value)
                return false;

            // Mode
            if (!string.IsNullOrWhiteSpace(rule.ModeEquals))
            {
                if (!string.Equals(tx.Mode?.Trim(), rule.ModeEquals.Trim(), StringComparison.OrdinalIgnoreCase))
                    return false;
            }

            // Bank
            if (!string.IsNullOrWhiteSpace(rule.BankEquals))
            {
                if (!string.Equals(tx.BankType?.Trim(), rule.BankEquals.Trim(), StringComparison.OrdinalIgnoreCase))
                    return false;
            }

            return true;
        }

        private static string CombineTags(string? existing, string? newTags)
        {
            if (string.IsNullOrWhiteSpace(newTags)) return existing ?? string.Empty;
            if (string.IsNullOrWhiteSpace(existing)) return newTags.Trim();

            var set = new HashSet<string>(existing.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(s => s.Trim()), StringComparer.OrdinalIgnoreCase);
            foreach (var t in newTags.Split(',', StringSplitOptions.RemoveEmptyEntries))
            {
                set.Add(t.Trim());
            }
            return string.Join(",", set);
        }
    }
}
