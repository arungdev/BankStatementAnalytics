using Microsoft.AspNetCore.Mvc;
using NHibernate.Linq;
using Common.Framework.Data;
using Common.Framework.Web;
using BankStatementAnalytics.Models;
using System;
using System.Linq;
using System.Threading.Tasks;

namespace BankStatementAnalytics.Controllers.Api
{
    [ApiController]
    [Route("api/categories")]
    public class CategoriesApiController : TenantControllerBase
    {
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
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var category = new Category { Name = req.Name, OwnerUserId = CurrentUserId };
            await session.SaveAsync(category);
            await tx.CommitAsync();

            return Ok(new { Id = category.Id, Name = category.Name, SubCategories = new string[0] });
        }

        [HttpPut("{id}")]
        public async Task<IActionResult> Update(int id, [FromBody] CategoryDto req)
        {
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var category = session.Get<Category>(id);
            if (!Owns(category)) return NotFound();

            category.Name = req.Name;
            await session.UpdateAsync(category);
            await tx.CommitAsync();

            return NoContent();
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
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var category = session.Get<Category>(id);
            if (!Owns(category)) return NotFound();

            var sub = new SubCategory { Name = req.Name, Category = category };
            category.SubCategories.Add(sub);

            await session.SaveAsync(sub);
            await session.UpdateAsync(category);
            await tx.CommitAsync();

            return Ok();
        }

        [HttpDelete("{id}/subcategories/{subName}")]
        public async Task<IActionResult> DeleteSubCategory(int id, string subName)
        {
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var category = session.Get<Category>(id);
            if (!Owns(category)) return NotFound();

            var sub = category.SubCategories.FirstOrDefault(s => s.Name.Equals(Uri.UnescapeDataString(subName), StringComparison.OrdinalIgnoreCase));
            if (sub != null)
            {
                category.SubCategories.Remove(sub);
                await session.DeleteAsync(sub);
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
