using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using BankStatementAnalytics.Models;
using Common.Framework.Data;
using Common.Framework.Web;
using Microsoft.AspNetCore.Mvc;

namespace BankStatementAnalytics.Controllers.Api
{
    [ApiController]
    [Route("api/tags")]
    public class TagApiController : TenantControllerBase
    {
        private const int MaxNameLength = 50;

        private static bool TryNormalizeName(string? raw, out string name, out string? error)
        {
            var trimmed = (raw ?? string.Empty).Trim();
            if (trimmed.StartsWith("#"))
                trimmed = trimmed.TrimStart('#').Trim();

            name = Regex.Replace(trimmed, @"\s+", " ");
            error = null;

            if (name.Length == 0)
                error = "Tag name is required.";
            else if (name.Length > MaxNameLength)
                error = $"Tag name can be at most {MaxNameLength} characters.";
            else if (name.Any(char.IsControl))
                error = "Tag name can't contain control characters.";

            return error == null;
        }

        private bool NameTaken(NHibernate.ISession session, string name, long? exceptId = null)
        {
            return session.Query<Tag>()
                .Where(t => t.OwnerUserId == CurrentUserId)
                .Select(t => new { t.Id, t.Name })
                .ToList()
                .Any(t => t.Id != exceptId && string.Equals(t.Name, name, StringComparison.OrdinalIgnoreCase));
        }

        [HttpGet]
        public IActionResult GetAll()
        {
            using var session = DbHelper.GetSession();
            var tags = session.Query<Tag>()
                .Where(t => t.OwnerUserId == CurrentUserId)
                .OrderBy(t => t.Name)
                .ToList();

            var accountIds = session.Query<Account>()
                .Where(a => a.OwnerUserId == CurrentUserId)
                .Select(a => a.Id)
                .ToList();

            var txTags = accountIds.Count > 0
                ? session.Query<BankTransaction>()
                    .Where(t => accountIds.Contains(t.AccountId) && t.Tags != null && t.Tags != "")
                    .Select(t => t.Tags)
                    .ToList()
                : new List<string?>();

            var tagCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            foreach (var raw in txTags)
            {
                if (string.IsNullOrWhiteSpace(raw)) continue;
                var parts = raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                foreach (var p in parts.Distinct(StringComparer.OrdinalIgnoreCase))
                {
                    tagCounts[p] = tagCounts.TryGetValue(p, out var c) ? c + 1 : 1;
                }
            }

            // Sync any tags found on existing transactions into the Tags table for this user
            var existingNames = new HashSet<string>(tags.Select(t => t.Name), StringComparer.OrdinalIgnoreCase);
            var missing = tagCounts.Keys.Where(name => !existingNames.Contains(name)).ToList();
            if (missing.Count > 0)
            {
                using var tx = session.BeginTransaction();
                foreach (var m in missing)
                {
                    if (TryNormalizeName(m, out var norm, out _))
                    {
                        var newTag = new Tag { Name = norm, OwnerUserId = CurrentUserId };
                        session.Save(newTag);
                        tags.Add(newTag);
                        existingNames.Add(norm);
                    }
                }
                tx.Commit();
            }

            var result = tags
                .OrderBy(t => t.Name)
                .Select(t => new
                {
                    Id = t.Id,
                    Name = t.Name,
                    UsageCount = tagCounts.TryGetValue(t.Name, out var c) ? c : 0
                }).ToList();

            return Ok(result);
        }

        [HttpGet("recent")]
        public IActionResult GetRecent([FromQuery] int limit = 8)
        {
            limit = Math.Clamp(limit, 1, 50);

            using var session = DbHelper.GetSession();

            var accountIds = session.Query<Account>()
                .Where(a => a.OwnerUserId == CurrentUserId)
                .Select(a => a.Id)
                .ToList();

            if (accountIds.Count == 0)
                return Ok(Array.Empty<string>());

            var recentTxTags = session.Query<BankTransaction>()
                .Where(t => accountIds.Contains(t.AccountId) && t.Tags != null && t.Tags != "")
                .OrderByDescending(t => t.TransactionDate)
                .ThenByDescending(t => t.ImportedOn)
                .Select(t => t.Tags)
                .Take(200)
                .ToList();

            var recentTags = new List<string>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var raw in recentTxTags)
            {
                if (string.IsNullOrWhiteSpace(raw)) continue;
                var parts = raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                foreach (var tag in parts)
                {
                    if (seen.Add(tag))
                    {
                        recentTags.Add(tag);
                        if (recentTags.Count >= limit) break;
                    }
                }
                if (recentTags.Count >= limit) break;
            }

            return Ok(recentTags);
        }

        [HttpPost]
        public async Task<IActionResult> Create([FromBody] TagDto req)
        {
            if (!TryNormalizeName(req?.Name, out var name, out var error))
                return BadRequest(error);

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            if (NameTaken(session, name))
                return Conflict($"A tag named \"{name}\" already exists.");

            var tag = new Tag { Name = name, OwnerUserId = CurrentUserId };
            await session.SaveAsync(tag);
            await tx.CommitAsync();

            return Ok(new { Id = tag.Id, Name = tag.Name, UsageCount = 0 });
        }

        [HttpPut("{id}")]
        public async Task<IActionResult> Update(long id, [FromBody] TagDto req)
        {
            if (!TryNormalizeName(req?.Name, out var name, out var error))
                return BadRequest(error);

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var tag = session.Get<Tag>(id);
            if (!Owns(tag)) return NotFound();

            if (NameTaken(session, name, exceptId: id))
                return Conflict($"A tag named \"{name}\" already exists.");

            var oldName = tag.Name;
            tag.Name = name;
            await session.UpdateAsync(tag);

            // Update all transactions having oldName for this user's accounts
            var accountIds = session.Query<Account>()
                .Where(a => a.OwnerUserId == CurrentUserId)
                .Select(a => a.Id)
                .ToList();

            if (accountIds.Count > 0)
            {
                var transactions = session.Query<BankTransaction>()
                    .Where(t => accountIds.Contains(t.AccountId) && t.Tags != null && t.Tags != "")
                    .ToList();

                foreach (var t in transactions)
                {
                    var list = t.Tags?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList() ?? new List<string>();
                    var replaced = false;
                    for (int i = 0; i < list.Count; i++)
                    {
                        if (string.Equals(list[i], oldName, StringComparison.OrdinalIgnoreCase))
                        {
                            list[i] = name;
                            replaced = true;
                        }
                    }
                    if (replaced)
                    {
                        var distinct = list.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
                        t.Tags = string.Join(",", distinct);
                        await session.UpdateAsync(t);
                    }
                }
            }

            await tx.CommitAsync();
            return NoContent();
        }

        [HttpDelete("{id}")]
        public async Task<IActionResult> Delete(long id)
        {
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var tag = session.Get<Tag>(id);
            if (!Owns(tag)) return NotFound();

            var tagName = tag.Name;
            await session.DeleteAsync(tag);

            // Also clean up this tag from transactions
            var accountIds = session.Query<Account>()
                .Where(a => a.OwnerUserId == CurrentUserId)
                .Select(a => a.Id)
                .ToList();

            if (accountIds.Count > 0)
            {
                var transactions = session.Query<BankTransaction>()
                    .Where(t => accountIds.Contains(t.AccountId) && t.Tags != null && t.Tags != "")
                    .ToList();

                foreach (var t in transactions)
                {
                    var list = t.Tags?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList() ?? new List<string>();
                    if (list.RemoveAll(x => string.Equals(x, tagName, StringComparison.OrdinalIgnoreCase)) > 0)
                    {
                        t.Tags = list.Count > 0 ? string.Join(",", list) : null;
                        await session.UpdateAsync(t);
                    }
                }
            }

            await tx.CommitAsync();
            return NoContent();
        }
    }

    public class TagDto
    {
        public string Name { get; set; } = string.Empty;
    }
}
