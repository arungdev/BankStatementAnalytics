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
