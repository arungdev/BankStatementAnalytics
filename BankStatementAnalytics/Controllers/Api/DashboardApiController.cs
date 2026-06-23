using Microsoft.AspNetCore.Mvc;
using NHibernate.Linq;
using Common.Framework.Data;
using BankStatementAnalytics.Models;
using System;
using System.Linq;
using System.Threading.Tasks;
using Common.Framework.Logging;
using System.Collections.Generic;

namespace BankStatementAnalytics.Controllers.Api
{
    [ApiController]
    [Route("api/dashboard")]
    public class DashboardApiController : ControllerBase
    {
        [HttpGet]
        public async Task<IActionResult> GetDashboardData([FromQuery] int accountId)
        {
            if (accountId == 0)
            {
                return Ok(null); // Frontend handles null data
            }

            try
            {
                using var session = DbHelper.GetSession();

                // Fetch all transactions for the account (HDFC + IOB unified)
                var transactions = await session.Query<BankTransaction>()
                    .Where(t => t.AccountId == accountId)
                    .Fetch(t => t.CounterParty) // Eagerly fetch CounterParty
                    .ToListAsync();

                var allTransactions = transactions
                    .Select(t => new UnifiedTransaction
                    {
                        Id = t.BankReference,
                        Date = t.TransactionDate,
                        Spend = t.Debit,
                        Income = t.Credit,
                        CounterPartyName = t.CounterParty?.Name,
                        Mode = t.Mode
                    })
                    .ToList();

                if (!allTransactions.Any())
                {
                    // Return a default structure if no transactions
                    return Ok(new
                    {
                        totalIncome = 0,
                        totalSpends = 0,
                        totalTransactions = 0,
                        topMerchants = new List<object>(),
                        recentTransactions = new List<object>()
                    });
                }

                // Calculate stats
                var totalIncome = allTransactions.Sum(t => t.Income);
                var totalSpends = allTransactions.Sum(t => t.Spend);
                var totalTransactions = allTransactions.Count();

                // Calculate top spending merchants
                var topMerchants = allTransactions
                    .Where(t => t.Spend > 0 && !string.IsNullOrEmpty(t.CounterPartyName))
                    .GroupBy(t => t.CounterPartyName)
                    .Select(g => new {
                        name = g.Key,
                        amount = g.Sum(t => t.Spend)
                    })
                    .OrderByDescending(g => g.amount)
                    .Take(5)
                    .ToList();

                // Get recent transactions
                var recentTransactions = allTransactions
                    .OrderByDescending(t => t.Date)
                    .Take(5)
                    .Select(t => new {
                        id = t.Id,
                        name = t.CounterPartyName ?? "N/A",
                        date = t.Date,
                        mode = t.Mode,
                        amount = t.Income > 0 ? t.Income : -t.Spend // Frontend expects negative for spends
                    })
                    .ToList();

                return Ok(new { totalIncome, totalSpends, totalTransactions, topMerchants, recentTransactions });
            }
            catch (Exception ex)
            {
                Log.Exception(ex);
                return StatusCode(500, "Internal server error while fetching dashboard data.");
            }
        }
        [HttpGet("insights")]
        public async Task<IActionResult> GetInsights(
    [FromQuery] string accountIds,
    [FromQuery] DateTime? startDate = null,
    [FromQuery] DateTime? endDate = null)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(accountIds))
                    return BadRequest("accountIds is required.");

                var ids = accountIds.Split(',')
                    .Select(s => long.TryParse(s.Trim(), out var id) ? id : 0)
                    .Where(id => id > 0)
                    .ToList();

                if (!ids.Any())
                    return BadRequest("No valid accountIds provided.");

                using var session = DbHelper.GetSession();

                var query = session.Query<BankTransaction>()
                    .Where(t => ids.Contains(t.AccountId) && t.Debit > 0);

                if (startDate.HasValue)
                    query = query.Where(t => t.TransactionDate >= startDate.Value.Date);

                if (endDate.HasValue)
                    query = query.Where(t => t.TransactionDate <= endDate.Value.Date.AddDays(1).AddTicks(-1));

                var transactions = await query
                    .Fetch(t => t.CounterParty)
                    .ToListAsync();

                // By Category
                var byCategory = transactions
                    .GroupBy(t => t.CategoryOverride ?? t.CounterParty?.Category ?? "Uncategorized")
                    .Select(g => new
                    {
                        name = g.Key,
                        total = g.Sum(t => t.Debit),
                        count = g.Count()
                    })
                    .OrderByDescending(x => x.total)
                    .ToList();

                // By Merchant
                var byMerchant = transactions
                    .Where(t => t.CounterParty != null)
                    .GroupBy(t => t.CounterParty!.Name)
                    .Select(g => new
                    {
                        name = g.Key,
                        total = g.Sum(t => t.Debit),
                        count = g.Count()
                    })
                    .OrderByDescending(x => x.total)
                    .Take(20)
                    .ToList();

                // By Tag
                var byTag = transactions
                    .Where(t => !string.IsNullOrWhiteSpace(t.Tags))
                    .SelectMany(t => t.Tags!.Split(',')
                        .Select(tag => new { tag = tag.Trim(), t.Debit }))
                    .GroupBy(x => x.tag)
                    .Select(g => new
                    {
                        name = g.Key,
                        total = g.Sum(x => x.Debit),
                        count = g.Count()
                    })
                    .OrderByDescending(x => x.total)
                    .ToList();

                return Ok(new { byCategory, byMerchant, byTag });
            }
            catch (Exception ex)
            {
                Log.Exception(ex);
                return StatusCode(500, "Internal server error");
            }
        }
        [HttpGet("insights/transactions")]
        public async Task<IActionResult> GetInsightTransactions(
    [FromQuery] string accountIds,
    [FromQuery] string groupBy,
    [FromQuery] string groupValue,
    [FromQuery] DateTime? startDate = null,
    [FromQuery] DateTime? endDate = null)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(accountIds))
                    return BadRequest("accountIds is required.");

                var ids = accountIds.Split(',')
                    .Select(s => long.TryParse(s.Trim(), out var id) ? id : 0)
                    .Where(id => id > 0)
                    .ToList();

                if (!ids.Any())
                    return BadRequest("No valid accountIds provided.");

                using var session = DbHelper.GetSession();

                // Build IQueryable<BankTransaction> first — no Fetch yet
                IQueryable<BankTransaction> query = session.Query<BankTransaction>()
                    .Where(t => ids.Contains(t.AccountId) && t.Debit > 0);

                if (startDate.HasValue)
                    query = query.Where(t => t.TransactionDate >= startDate.Value.Date);

                if (endDate.HasValue)
                    query = query.Where(t => t.TransactionDate <= endDate.Value.Date.AddDays(1).AddTicks(-1));

                // Apply Fetch at the end, after all Where clauses
                var transactions = await query
                    .Fetch(t => t.CounterParty)
                    .ToListAsync();

                // Filter in-memory by the clicked group
                IEnumerable<BankTransaction> filtered = groupBy switch
                {
                    "byCategory" => transactions.Where(t =>
                        (t.CategoryOverride ?? t.CounterParty?.Category ?? "Uncategorized") == groupValue),

                    "byMerchant" => transactions.Where(t =>
                        t.CounterParty?.Name == groupValue),

                    "byTag" => transactions.Where(t =>
                        !string.IsNullOrWhiteSpace(t.Tags) &&
                        t.Tags.Split(',').Select(tag => tag.Trim()).Contains(groupValue)),

                    _ => Enumerable.Empty<BankTransaction>()
                };

                var result = filtered
                    .OrderByDescending(t => t.TransactionDate)
                    .Select(t => new {
                        id = t.BankReference,
                        date = t.TransactionDate,
                        description = t.CounterParty?.Name ?? t.BankReference,
                        accountId = t.AccountId,
                        amount = t.Debit
                    })
                    .ToList();

                return Ok(result);
            }
            catch (Exception ex)
            {
                Log.Exception(ex);
                return StatusCode(500, "Internal server error");
            }
        }
    }

    // Helper class for unified transaction data
    internal class UnifiedTransaction
    {
        public string Id { get; set; }
        public DateTime Date { get; set; }
        public decimal Spend { get; set; }
        public decimal Income { get; set; }
        public string CounterPartyName { get; set; }
        public string Mode { get; set; }
    }
}