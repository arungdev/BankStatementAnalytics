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
    [Route("api/rules")]
    public class RulesApiController : TenantControllerBase
    {
        private readonly RuleEngineService _ruleEngine;

        public RulesApiController(RuleEngineService ruleEngine)
        {
            _ruleEngine = ruleEngine;
        }

        // GET: api/rules
        [HttpGet]
        public async Task<IActionResult> GetRules()
        {
            using var session = DbHelper.GetSession();

            var rules = await session.Query<CategorizationRule>()
                .Where(r => r.OwnerUserId == CurrentUserId)
                .OrderBy(r => r.Priority)
                .ToListAsync();

            return Ok(rules);
        }

        // POST: api/rules
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] RuleDto req)
        {
            if (req == null || string.IsNullOrWhiteSpace(req.Name))
                return BadRequest("Rule name is required.");

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var maxPriority = await session.Query<CategorizationRule>()
                .Where(r => r.OwnerUserId == CurrentUserId)
                .Select(r => (int?)r.Priority)
                .MaxAsync() ?? 0;

            var rule = new CategorizationRule
            {
                OwnerUserId = CurrentUserId,
                Name = req.Name.Trim(),
                Priority = maxPriority + 1,
                Enabled = req.Enabled,
                NarrationContains = req.NarrationContains?.Trim(),
                NarrationRegex = req.NarrationRegex?.Trim(),
                MinAmount = req.MinAmount,
                MaxAmount = req.MaxAmount,
                ModeEquals = req.ModeEquals?.Trim(),
                BankEquals = req.BankEquals?.Trim(),
                SetCategory = req.SetCategory?.Trim(),
                SetSubCategory = req.SetSubCategory?.Trim(),
                SetTags = req.SetTags?.Trim(),
                SetNote = req.SetNote?.Trim(),
                CreatedOn = DateTime.Now,
                UpdatedOn = DateTime.Now
            };

            await session.SaveAsync(rule);
            await tx.CommitAsync();

            return Ok(new { rule.Id });
        }

        // PUT: api/rules/{id}
        [HttpPut("{id}")]
        public async Task<IActionResult> Update(int id, [FromBody] RuleDto req)
        {
            if (req == null || string.IsNullOrWhiteSpace(req.Name))
                return BadRequest("Rule name is required.");

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var rule = await session.GetAsync<CategorizationRule>(id);
            if (!Owns(rule)) return NotFound();

            rule.Name = req.Name.Trim();
            rule.Enabled = req.Enabled;
            rule.NarrationContains = req.NarrationContains?.Trim();
            rule.NarrationRegex = req.NarrationRegex?.Trim();
            rule.MinAmount = req.MinAmount;
            rule.MaxAmount = req.MaxAmount;
            rule.ModeEquals = req.ModeEquals?.Trim();
            rule.BankEquals = req.BankEquals?.Trim();
            rule.SetCategory = req.SetCategory?.Trim();
            rule.SetSubCategory = req.SetSubCategory?.Trim();
            rule.SetTags = req.SetTags?.Trim();
            rule.SetNote = req.SetNote?.Trim();
            rule.UpdatedOn = DateTime.Now;

            await session.UpdateAsync(rule);
            await tx.CommitAsync();

            return NoContent();
        }

        // DELETE: api/rules/{id}
        [HttpDelete("{id}")]
        public async Task<IActionResult> Delete(int id)
        {
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var rule = await session.GetAsync<CategorizationRule>(id);
            if (!Owns(rule)) return NotFound();

            await session.DeleteAsync(rule);
            await tx.CommitAsync();

            return NoContent();
        }

        // POST: api/rules/test
        [HttpPost("test")]
        public IActionResult TestRule([FromBody] RuleDto req)
        {
            var probe = new CategorizationRule
            {
                NarrationContains = req.NarrationContains?.Trim(),
                NarrationRegex = req.NarrationRegex?.Trim(),
                MinAmount = req.MinAmount,
                MaxAmount = req.MaxAmount,
                ModeEquals = req.ModeEquals?.Trim(),
                BankEquals = req.BankEquals?.Trim(),
                SetCategory = req.SetCategory?.Trim(),
                SetSubCategory = req.SetSubCategory?.Trim(),
                SetTags = req.SetTags?.Trim(),
                SetNote = req.SetNote?.Trim()
            };

            var matches = _ruleEngine.TestRule(CurrentUserId, probe);
            return Ok(matches);
        }

        // POST: api/rules/apply-all
        [HttpPost("apply-all")]
        public async Task<IActionResult> ApplyAll()
        {
            var count = await _ruleEngine.ApplyAllRulesRetroactivelyAsync(CurrentUserId);
            return Ok(new { updatedCount = count });
        }
    }

    public class RuleDto
    {
        public string Name { get; set; } = string.Empty;
        public bool Enabled { get; set; } = true;
        public string? NarrationContains { get; set; }
        public string? NarrationRegex { get; set; }
        public decimal? MinAmount { get; set; }
        public decimal? MaxAmount { get; set; }
        public string? ModeEquals { get; set; }
        public string? BankEquals { get; set; }
        public string? SetCategory { get; set; }
        public string? SetSubCategory { get; set; }
        public string? SetTags { get; set; }
        public string? SetNote { get; set; }
    }
}
