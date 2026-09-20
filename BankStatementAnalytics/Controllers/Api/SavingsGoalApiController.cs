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
    [Route("api/goals")]
    public class SavingsGoalApiController : TenantControllerBase
    {
        // GET: api/goals
        [HttpGet]
        public async Task<IActionResult> GetGoals()
        {
            using var session = DbHelper.GetSession();

            var goals = await session.Query<SavingsGoal>()
                .Where(g => g.OwnerUserId == CurrentUserId)
                .OrderByDescending(g => g.CreatedOn)
                .ToListAsync();

            var now = DateTime.Today;

            var views = goals.Select(g =>
            {
                var remaining = Math.Max(0, g.TargetAmount - g.CurrentSaved);
                var percent = g.TargetAmount > 0
                    ? Math.Min(100, Math.Round((double)(g.CurrentSaved / g.TargetAmount) * 100, 1))
                    : 0;

                int? monthsLeft = null;
                decimal? monthlyNeeded = null;

                if (g.TargetDate.HasValue && g.TargetDate.Value > now)
                {
                    var months = ((g.TargetDate.Value.Year - now.Year) * 12) + g.TargetDate.Value.Month - now.Month;
                    monthsLeft = Math.Max(1, months);
                    monthlyNeeded = remaining > 0 ? Math.Round(remaining / monthsLeft.Value, 2) : 0;
                }

                return new
                {
                    id = g.Id,
                    name = g.Name,
                    targetAmount = g.TargetAmount,
                    currentSaved = g.CurrentSaved,
                    remaining,
                    percent,
                    targetDate = g.TargetDate?.ToString("yyyy-MM-dd"),
                    monthsLeft,
                    monthlyNeeded,
                    category = g.Category,
                    notes = g.Notes,
                    status = g.Status,
                    createdOn = g.CreatedOn
                };
            }).ToList();

            return Ok(views);
        }

        // GET: api/goals/summary
        [HttpGet("summary")]
        public async Task<IActionResult> GetSummary()
        {
            using var session = DbHelper.GetSession();

            var goals = await session.Query<SavingsGoal>()
                .Where(g => g.OwnerUserId == CurrentUserId && g.Status == "Active")
                .ToListAsync();

            var totalTarget = goals.Sum(g => g.TargetAmount);
            var totalSaved = goals.Sum(g => g.CurrentSaved);
            var overallPercent = totalTarget > 0
                ? Math.Min(100, Math.Round((double)(totalSaved / totalTarget) * 100, 1))
                : 0;

            return Ok(new
            {
                totalTarget,
                totalSaved,
                overallPercent,
                activeGoalsCount = goals.Count
            });
        }

        // POST: api/goals
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] SavingsGoalDto req)
        {
            if (req == null || string.IsNullOrWhiteSpace(req.Name))
                return BadRequest("Name is required.");
            if (req.TargetAmount <= 0)
                return BadRequest("Target amount must be greater than zero.");

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var goal = new SavingsGoal
            {
                OwnerUserId = CurrentUserId,
                Name = req.Name.Trim(),
                TargetAmount = req.TargetAmount,
                CurrentSaved = Math.Max(0, req.CurrentSaved),
                TargetDate = req.TargetDate,
                Category = req.Category?.Trim(),
                Notes = req.Notes?.Trim(),
                Status = string.IsNullOrWhiteSpace(req.Status) ? "Active" : req.Status.Trim(),
                CreatedOn = DateTime.Now,
                UpdatedOn = DateTime.Now
            };

            await session.SaveAsync(goal);
            await tx.CommitAsync();

            return Ok(new { goal.Id });
        }

        // PUT: api/goals/{id}
        [HttpPut("{id}")]
        public async Task<IActionResult> Update(int id, [FromBody] SavingsGoalDto req)
        {
            if (req == null || string.IsNullOrWhiteSpace(req.Name))
                return BadRequest("Name is required.");
            if (req.TargetAmount <= 0)
                return BadRequest("Target amount must be greater than zero.");

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var goal = await session.GetAsync<SavingsGoal>(id);
            if (!Owns(goal)) return NotFound();

            goal.Name = req.Name.Trim();
            goal.TargetAmount = req.TargetAmount;
            goal.CurrentSaved = Math.Max(0, req.CurrentSaved);
            goal.TargetDate = req.TargetDate;
            goal.Category = req.Category?.Trim();
            goal.Notes = req.Notes?.Trim();
            if (!string.IsNullOrWhiteSpace(req.Status)) goal.Status = req.Status.Trim();
            goal.UpdatedOn = DateTime.Now;

            await session.UpdateAsync(goal);
            await tx.CommitAsync();

            return NoContent();
        }

        // POST: api/goals/{id}/contribute
        [HttpPost("{id}/contribute")]
        public async Task<IActionResult> AddContribution(int id, [FromBody] ContributionDto req)
        {
            if (req == null || req.Amount <= 0)
                return BadRequest("Contribution amount must be greater than zero.");

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var goal = await session.GetAsync<SavingsGoal>(id);
            if (!Owns(goal)) return NotFound();

            goal.CurrentSaved += req.Amount;
            if (goal.CurrentSaved >= goal.TargetAmount)
            {
                goal.Status = "Completed";
            }
            goal.UpdatedOn = DateTime.Now;

            await session.UpdateAsync(goal);
            await tx.CommitAsync();

            return Ok(new { goal.CurrentSaved, goal.Status });
        }

        // DELETE: api/goals/{id}
        [HttpDelete("{id}")]
        public async Task<IActionResult> Delete(int id)
        {
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var goal = await session.GetAsync<SavingsGoal>(id);
            if (!Owns(goal)) return NotFound();

            await session.DeleteAsync(goal);
            await tx.CommitAsync();

            return NoContent();
        }
    }

    public class SavingsGoalDto
    {
        public string Name { get; set; } = string.Empty;
        public decimal TargetAmount { get; set; }
        public decimal CurrentSaved { get; set; }
        public DateTime? TargetDate { get; set; }
        public string? Category { get; set; }
        public string? Notes { get; set; }
        public string? Status { get; set; }
    }

    public class ContributionDto
    {
        public decimal Amount { get; set; }
    }
}
