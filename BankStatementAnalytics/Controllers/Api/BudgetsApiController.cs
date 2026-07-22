using Microsoft.AspNetCore.Mvc;
using NHibernate.Linq;
using Common.Framework.Data;
using Common.Framework.Web;
using BankStatementAnalytics.Models;
using BankStatementAnalytics.Services;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace BankStatementAnalytics.Controllers.Api
{
    [ApiController]
    [Route("api/budgets")]
    public class BudgetsApiController : TenantControllerBase
    {
        // GET: api/budgets?monthsAgo=0 — each budget with the requested month's spend, remaining,
        // and % used. monthsAgo=0 is the current calendar month, 1 the previous month, etc.
        [HttpGet]
        public async Task<IActionResult> GetBudgets([FromQuery] int monthsAgo = 0)
        {
            using var session = DbHelper.GetSession();

            var ownedIds = AccountAccess.OwnedIds(session, CurrentUserId);

            var budgets = session.Query<Budget>()
                .Where(b => b.OwnerUserId == CurrentUserId)
                .ToList()
                .OrderBy(b => b.Category, StringComparer.OrdinalIgnoreCase)
                .ToList();

            var (monthStart, monthEnd) = MonthRange(monthsAgo);
            var spentByCategory = await SpendForMonthAsync(session, ownedIds, monthStart, monthEnd);

            var views = budgets.Select(b =>
            {
                spentByCategory.TryGetValue(b.Category, out var spent);
                var remaining = b.MonthlyLimit - spent;
                var percent = b.MonthlyLimit > 0 ? (double)(spent / b.MonthlyLimit) * 100 : 0;
                return new
                {
                    id = b.Id,
                    category = b.Category,
                    monthlyLimit = b.MonthlyLimit,
                    spent,
                    remaining,
                    percent = Math.Round(percent, 1),
                    overBudget = spent > b.MonthlyLimit
                };
            }).ToList();

            return Ok(new
            {
                month = monthStart.ToString("MMMM yyyy"),
                monthsAgo,
                isCurrentMonth = monthsAgo == 0,
                budgets = views
            });
        }

        // GET: api/budgets/months — every calendar month from the user's earliest transaction to now,
        // newest first, as { monthsAgo, label } so the client can offer a month picker.
        [HttpGet("months")]
        public async Task<IActionResult> GetMonths()
        {
            using var session = DbHelper.GetSession();

            var ownedIds = AccountAccess.OwnedIdSet(session, CurrentUserId);

            var (currentStart, _) = MonthRange(0);

            DateTime? earliest = null;
            if (ownedIds.Count > 0)
            {
                earliest = await session.Query<BankTransaction>()
                    .Where(t => ownedIds.Contains(t.AccountId))
                    .Select(t => (DateTime?)t.TransactionDate)
                    .MinAsync();
            }

            // Always include the current month; extend back to the earliest transaction if there is one.
            var earliestStart = earliest.HasValue
                ? new DateTime(earliest.Value.Year, earliest.Value.Month, 1)
                : currentStart;

            var months = new System.Collections.Generic.List<object>();
            for (var m = currentStart; m >= earliestStart; m = m.AddMonths(-1))
            {
                var monthsAgo = ((currentStart.Year - m.Year) * 12) + (currentStart.Month - m.Month);
                months.Add(new { monthsAgo, label = m.ToString("MMMM yyyy") });
            }

            return Ok(months);
        }

        // GET: api/budgets/suggestions — a suggested monthly limit per category, derived from the
        // user's average spend over the last six complete months (falls back to the current
        // partial month when that's all the history there is).
        [HttpGet("suggestions")]
        public async Task<IActionResult> GetSuggestions()
        {
            using var session = DbHelper.GetSession();

            var ownedIds = AccountAccess.OwnedIds(session, CurrentUserId);
            if (ownedIds.Count == 0)
                return Ok(Array.Empty<object>());

            var (currentStart, currentEnd) = MonthRange(0);

            // A partial month would skew the average low, so prefer complete months.
            var rows = await SpendRowsAsync(session, ownedIds, currentStart.AddMonths(-6), currentStart);
            if (rows.Count == 0)
                rows = await SpendRowsAsync(session, ownedIds, currentStart, currentEnd);
            if (rows.Count == 0)
                return Ok(Array.Empty<object>());

            var monthCount = rows.Select(r => new { r.Date.Year, r.Date.Month }).Distinct().Count();

            var suggestions = rows
                .GroupBy(r => r.CategoryOverride ?? r.MerchantCategory ?? "Uncategorized")
                .Select(g =>
                {
                    var avg = g.Sum(r => r.Debit) / monthCount;
                    return new
                    {
                        category = g.Key,
                        months = monthCount,
                        avgMonthly = Math.Round(avg),
                        suggested = RoundUpToNice(avg)
                    };
                })
                .Where(s => s.suggested > 0)
                .OrderBy(s => s.category, StringComparer.OrdinalIgnoreCase)
                .ToList();

            return Ok(suggestions);
        }

        // POST: api/budgets — create a budget for a category (one per category per user).
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] BudgetDto req)
        {
            if (req == null || string.IsNullOrWhiteSpace(req.Category))
                return BadRequest("Category is required.");
            if (req.MonthlyLimit <= 0)
                return BadRequest("MonthlyLimit must be greater than zero.");

            var category = req.Category.Trim();

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var exists = session.Query<Budget>()
                .Any(b => b.OwnerUserId == CurrentUserId && b.Category == category);
            if (exists)
                return Conflict($"A budget for \"{category}\" already exists.");

            var budget = new Budget
            {
                OwnerUserId = CurrentUserId,
                Category = category,
                MonthlyLimit = req.MonthlyLimit,
                CreatedOn = DateTime.Now,
                UpdatedOn = DateTime.Now
            };

            await session.SaveAsync(budget);
            await tx.CommitAsync();

            return Ok(new { budget.Id });
        }

        // PUT: api/budgets/{id} — change the monthly limit.
        [HttpPut("{id}")]
        public async Task<IActionResult> Update(int id, [FromBody] BudgetDto req)
        {
            if (req == null || req.MonthlyLimit <= 0)
                return BadRequest("MonthlyLimit must be greater than zero.");

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var budget = session.Get<Budget>(id);
            if (!Owns(budget)) return NotFound();

            budget.MonthlyLimit = req.MonthlyLimit;
            budget.UpdatedOn = DateTime.Now;

            await session.UpdateAsync(budget);
            await tx.CommitAsync();

            return NoContent();
        }

        // DELETE: api/budgets/{id}
        [HttpDelete("{id}")]
        public async Task<IActionResult> Delete(int id)
        {
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var budget = session.Get<Budget>(id);
            if (!Owns(budget)) return NotFound();

            await session.DeleteAsync(budget);
            await tx.CommitAsync();

            return NoContent();
        }

        // ── Helpers ──────────────────────────────────────────────────────────

        // Calendar-month window for a month offset back from today (0 = current, 1 = previous, …).
        // Returns [start, end) with an exclusive upper bound.
        private static (DateTime start, DateTime end) MonthRange(int monthsAgo)
        {
            var offset = monthsAgo < 0 ? 0 : monthsAgo;
            var now = DateTime.Now;
            var thisMonth = new DateTime(now.Year, now.Month, 1);
            var start = thisMonth.AddMonths(-offset);
            var end = start.AddMonths(1);
            return (start, end);
        }

        // Round a raw average up to a figure that reads like a limit someone would set.
        private static decimal RoundUpToNice(decimal value)
        {
            if (value <= 0) return 0;
            if (value < 100) return Math.Ceiling(value / 10) * 10;
            if (value < 1000) return Math.Ceiling(value / 50) * 50;
            return Math.Ceiling(value / 100) * 100;
        }

        private sealed class SpendRow
        {
            public decimal Debit { get; set; }
            public DateTime Date { get; set; }
            public string? CategoryOverride { get; set; }
            public string? MerchantCategory { get; set; }
        }

        // Budget-relevant debit rows (same filters as SpendForMonthAsync) within [from, to).
        private static async Task<List<SpendRow>> SpendRowsAsync(
            NHibernate.ISession session, IReadOnlyCollection<long> ownedIds, DateTime from, DateTime to)
        {
            return await session.Query<BankTransaction>()
                .Where(t => ownedIds.Contains(t.AccountId)
                         && t.Debit > 0
                         && (t.Mode == null || t.Mode != "TRANSFER")
                         && (t.EffectiveDate ?? t.TransactionDate) >= from
                         && (t.EffectiveDate ?? t.TransactionDate) < to)
                .Select(t => new SpendRow
                {
                    Debit = t.Debit,
                    Date = t.EffectiveDate ?? t.TransactionDate,
                    CategoryOverride = t.CategoryOverride,
                    MerchantCategory = t.CounterParty != null ? t.CounterParty.Category : null
                })
                .ToListAsync();
        }

        // Spend per resolved category across all of the user's accounts within [monthStart, monthEnd).
        private async Task<Dictionary<string, decimal>> SpendForMonthAsync(
            NHibernate.ISession session, IReadOnlyCollection<long> ownedIds, DateTime monthStart, DateTime monthEnd)
        {
            if (ownedIds.Count == 0)
                return new Dictionary<string, decimal>();

            // Narrow projection: only the two fields the category coalesce needs.
            var rows = await session.Query<BankTransaction>()
                .Where(t => ownedIds.Contains(t.AccountId)
                         && t.Debit > 0
                         // TRANSFER rows (e.g. credit-card bill payments) are the
                         // user's own money — they don't consume a budget.
                         && (t.Mode == null || t.Mode != "TRANSFER")
                         && (t.EffectiveDate ?? t.TransactionDate) >= monthStart
                         && (t.EffectiveDate ?? t.TransactionDate) < monthEnd)
                .Select(t => new
                {
                    t.Debit,
                    t.CategoryOverride,
                    MerchantCategory = t.CounterParty != null ? t.CounterParty.Category : null
                })
                .ToListAsync();

            return rows
                .GroupBy(t => t.CategoryOverride ?? t.MerchantCategory ?? "Uncategorized")
                .ToDictionary(g => g.Key, g => g.Sum(t => t.Debit));
        }
    }

    public class BudgetDto
    {
        public string Category { get; set; } = string.Empty;
        public decimal MonthlyLimit { get; set; }
    }
}
