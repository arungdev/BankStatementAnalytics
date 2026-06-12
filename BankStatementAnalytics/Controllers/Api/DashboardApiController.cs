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