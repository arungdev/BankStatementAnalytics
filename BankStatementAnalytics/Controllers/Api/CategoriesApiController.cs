using Microsoft.AspNetCore.Mvc;
using NHibernate.Linq;
using Common.Framework.Data;
using Common.Framework.Web;
using BankStatementAnalytics.Models;
using System;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace BankStatementAnalytics.Controllers.Api
{
    [ApiController]
    [Route("api/categories")]
    public class CategoriesApiController : TenantControllerBase
    {
        // Names are typed by hand in Settings and inline from the category pickers, then
        // copied verbatim onto merchants and transactions — where the column is only
        // varchar(100) (see MerchantMap). 50 is the cap the Settings inputs already
        // enforce; keeping the server on the same number means no UI can create a name
        // another one refuses to rename.
        private const int MaxNameLength = 50;

        // The single gate every write path goes through. Collapses whitespace so
        // "Food  Delivery" and "Food Delivery" can't coexist as two categories that look
        // identical in every list, then rejects what can't be stored or displayed.
        // `what` names the thing in the message ("Category" / "Sub-category").
        private static bool TryNormalizeName(string raw, string what, out string name, out string error)
        {
            name = Regex.Replace((raw ?? string.Empty).Trim(), @"\s+", " ");
            error = null;

            if (name.Length == 0)
                error = $"{what} name is required.";
            else if (name.Length > MaxNameLength)
                error = $"{what} name can be at most {MaxNameLength} characters.";
            else if (name.Any(char.IsControl))
                error = $"{what} name can't contain control characters.";

            return error == null;
        }

        [HttpGet]
        public IActionResult GetAll()
        {
            using var session = DbHelper.GetSession();
            var categories = session.Query<Category>()
                .Where(x => x.OwnerUserId == CurrentUserId)
                .FetchMany(x => x.SubCategories)
                .ToList()
                .Select(c => new
                {
                    Id = c.Id,
                    Name = c.Name,
                    SubCategories = c.SubCategories.Select(s => s.Name).ToList()
                }).ToList();

            return Ok(categories);
        }

        // Most-used category values for the current user, ranked by how many of their
        // transactions currently resolve to each one (effective value = per-transaction
        // override, else the merchant default). Drives the "Frequently used" group at
        // the top of the category picker. Ranks by the sub-category the user would pick,
        // falling back to the parent category for transactions that carry only a category.
        [HttpGet("usage")]
        public IActionResult GetUsage([FromQuery] int limit = 6)
        {
            // Take() throws on a negative count, and nothing sensible asks for hundreds
            // of "frequently used" chips — clamp rather than 500 on a hand-edited URL.
            limit = Math.Clamp(limit, 1, 50);

            using var session = DbHelper.GetSession();

            var accountIds = session.Query<Account>()
                .Where(a => a.OwnerUserId == CurrentUserId)
                .Select(a => a.Id)
                .ToList();

            if (accountIds.Count == 0)
                return Ok(Array.Empty<object>());

            var resolved = session.Query<BankTransaction>()
                .Where(t => accountIds.Contains(t.AccountId))
                .Select(t => new
                {
                    Sub = t.SubCategoryOverride ?? (t.CounterParty != null ? t.CounterParty.SubCategory : null),
                    Cat = t.CategoryOverride ?? (t.CounterParty != null ? t.CounterParty.Category : null)
                })
                .ToList();

            var top = resolved
                .Select(r => !string.IsNullOrWhiteSpace(r.Sub) ? r.Sub : r.Cat)
                .Where(v => !string.IsNullOrWhiteSpace(v))
                .GroupBy(v => v, StringComparer.OrdinalIgnoreCase)
                .Select(g => new { Name = g.Key, Count = g.Count() })
                .OrderByDescending(x => x.Count)
                .ThenBy(x => x.Name)
                .Take(limit)
                .ToList();

            return Ok(top);
        }

        [HttpPost]
        public async Task<IActionResult> Create([FromBody] CategoryDto req)
        {
            if (!TryNormalizeName(req?.Name, "Category", out var name, out var error))
                return BadRequest(error);

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            if (NameTaken(session, name))
                return Conflict($"A category named \"{name}\" already exists.");

            var category = new Category { Name = name, OwnerUserId = CurrentUserId };
            await session.SaveAsync(category);
            await tx.CommitAsync();

            return Ok(new { Id = category.Id, Name = category.Name, SubCategories = new string[0] });
        }

        [HttpPut("{id}")]
        public async Task<IActionResult> Update(int id, [FromBody] CategoryDto req)
        {
            if (!TryNormalizeName(req?.Name, "Category", out var name, out var error))
                return BadRequest(error);

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var category = session.Get<Category>(id);
            if (!Owns(category)) return NotFound();

            if (NameTaken(session, name, exceptId: id))
                return Conflict($"A category named \"{name}\" already exists.");

            category.Name = name;
            await session.UpdateAsync(category);
            await tx.CommitAsync();

            return NoContent();
        }

        // Category names are unique per user, case-insensitively. There's no DB
        // constraint expressing that (mapping-by-code can't, and the comparison is
        // case-insensitive), so every write path checks here.
        private bool NameTaken(NHibernate.ISession session, string name, int? exceptId = null)
        {
            return session.Query<Category>()
                .Where(c => c.OwnerUserId == CurrentUserId)
                .Select(c => new { c.Id, c.Name })
                .ToList()
                .Any(c => c.Id != exceptId && string.Equals(c.Name, name, StringComparison.OrdinalIgnoreCase));
        }

        [HttpDelete("{id}")]
        public async Task<IActionResult> Delete(int id)
        {
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var category = session.Get<Category>(id);
            if (!Owns(category)) return NotFound();

            await session.DeleteAsync(category);
            await tx.CommitAsync();

            return NoContent();
        }

        [HttpPost("{id}/subcategories")]
        public async Task<IActionResult> AddSubCategory(int id, [FromBody] CategoryDto req)
        {
            if (!TryNormalizeName(req?.Name, "Sub-category", out var name, out var error))
                return BadRequest(error);

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var category = session.Get<Category>(id);
            if (!Owns(category)) return NotFound();

            if (category.SubCategories.Any(s => string.Equals(s.Name, name, StringComparison.OrdinalIgnoreCase)))
                return Conflict($"\"{category.Name}\" already has a sub-category named \"{name}\".");

            var sub = new SubCategory { Name = name, Category = category };
            category.SubCategories.Add(sub);

            await session.SaveAsync(sub);
            await session.UpdateAsync(category);
            await tx.CommitAsync();

            return Ok(new { Id = sub.Id, Name = sub.Name });
        }

        [HttpDelete("{id}/subcategories/{subName}")]
        public async Task<IActionResult> DeleteSubCategory(int id, string subName)
        {
            // Routing has already URL-decoded the segment, so the client's single
            // encodeURIComponent is accounted for. Do not unescape again: a second pass
            // throws UriFormatException on a legitimate name containing '%' ("50% off")
            // and silently mangles one containing a "%20"-shaped substring.
            var target = (subName ?? string.Empty).Trim();
            if (target.Length == 0)
                return BadRequest("Sub-category name is required.");

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var category = session.Get<Category>(id);
            if (!Owns(category)) return NotFound();

            // Sub-categories are identified by name everywhere else (transactions and
            // merchants store the name, not the id), so a delete removes every row with
            // that name — which also clears out duplicates created before names were
            // enforced unique.
            var subs = category.SubCategories
                .Where(s => s.Name.Equals(target, StringComparison.OrdinalIgnoreCase))
                .ToList();

            if (subs.Count > 0)
            {
                foreach (var sub in subs)
                {
                    category.SubCategories.Remove(sub);
                    await session.DeleteAsync(sub);
                }
                await session.UpdateAsync(category);
                await tx.CommitAsync();
            }

            return NoContent();
        }
    }

    public class CategoryDto
    {
        public string Name { get; set; } = string.Empty;
    }
}
