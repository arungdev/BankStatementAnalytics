using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using NHibernate.Linq;
using Common.Framework.Data;
using Common.Framework.Web;
using BankStatementAnalytics.Models;
using BankStatementAnalytics.Services;

namespace BankStatementAnalytics.Controllers.Api
{
    [ApiController]
    [Route("api/search")]
    public class SearchApiController : TenantControllerBase
    {
        [HttpGet]
        public async Task<IActionResult> Search([FromQuery] string? q)
        {
            if (string.IsNullOrWhiteSpace(q) || q.Trim().Length < 2)
            {
                return Ok(new
                {
                    transactions = new List<object>(),
                    merchants = new List<object>(),
                    navigation = new List<object>()
                });
            }

            var query = q.Trim();
            var lower = query.ToLower();
            using var session = DbHelper.GetSession();

            var ownedIds = await AccountAccess.OwnedIdSetAsync(CurrentUserId);
            if (ownedIds.Count == 0)
            {
                return Ok(new { transactions = new List<object>(), merchants = new List<object>(), navigation = new List<object>() });
            }

            bool isNumber = decimal.TryParse(query, out decimal parsedAmount);

            // 1. Transactions search
            var txQuery = session.Query<BankTransaction>()
                .Where(t => ownedIds.Contains(t.AccountId));

            if (isNumber)
            {
                txQuery = txQuery.Where(t =>
                    t.Debit == parsedAmount ||
                    t.Credit == parsedAmount ||
                    t.Description.ToLower().Contains(lower) ||
                    t.Narration.ToLower().Contains(lower));
            }
            else
            {
                txQuery = txQuery.Where(t =>
                    t.Description.ToLower().Contains(lower) ||
                    t.Narration.ToLower().Contains(lower) ||
                    (t.CounterParty != null && t.CounterParty.Name.ToLower().Contains(lower)) ||
                    (t.Note != null && t.Note.ToLower().Contains(lower)) ||
                    (t.Tags != null && t.Tags.ToLower().Contains(lower)) ||
                    t.BankReference.ToLower().Contains(lower));
            }

            var txResults = await txQuery
                .OrderByDescending(t => t.TransactionDate)
                .Take(25)
                .Select(t => new
                {
                    accountId = t.AccountId,
                    bankReference = t.BankReference,
                    bankType = t.BankType,
                    date = t.TransactionDate,
                    debit = t.Debit,
                    credit = t.Credit,
                    description = t.Description,
                    narration = t.Narration,
                    merchant = t.CounterParty != null ? t.CounterParty.Name : null,
                    category = t.CategoryOverride ?? (t.CounterParty != null ? t.CounterParty.Category : "Uncategorized"),
                    tags = t.Tags,
                    note = t.Note
                })
                .ToListAsync();

            // 2. Merchants search
            var merchantResults = await session.Query<Merchant>()
                .Where(m => (m.OwnerUserId == null || m.OwnerUserId == CurrentUserId) && (
                    m.Name.ToLower().Contains(lower) ||
                    (m.Category != null && m.Category.ToLower().Contains(lower)) ||
                    (m.SubCategory != null && m.SubCategory.ToLower().Contains(lower))
                ))
                .Take(5)
                .Select(m => new
                {
                    id = m.Id,
                    name = m.Name,
                    friendlyName = m.FriendlyName,
                    category = m.Category,
                    subCategory = m.SubCategory
                })
                .ToListAsync();

            // 3. Quick Navigation links
            var navItems = new List<dynamic>
            {
                new { title = "Overview", path = "/", description = "Financial snapshot, cash flow forecast, and recent activity" },
                new { title = "Transactions", path = "/transactions", description = "View, filter, categorize, and split transactions" },
                new { title = "Trends", path = "/trends", description = "Spending heatmap calendar, monthly trends, and charts" },
                new { title = "Insights", path = "/insights", description = "Category breakdown, merchant distribution, and export" },
                new { title = "Goals", path = "/goals", description = "Savings goals, target tracking, and contributions" },
                new { title = "Bills & Subscriptions", path = "/bills", description = "Recurring bills, subscriptions tracker, and price alerts" },
                new { title = "Reports", path = "/reports", description = "Monthly, yearly, and Year-in-Review annual summary" },
                new { title = "Upload Statement", path = "/upload", description = "Import new bank or credit card statements" },
                new { title = "Settings", path = "/settings", description = "General preferences, linked accounts, and configuration" },
                new { title = "Settings: Accounts", path = "/settings?tab=accounts", description = "Manage bank accounts, credit cards, and auto-import folder" },
                new { title = "Settings: Categories", path = "/settings?tab=categories", description = "Manage spending categories and sub-categories" },
                new { title = "Settings: Tags", path = "/settings?tab=tags", description = "Manage transaction tags and custom labels" },
                new { title = "Settings: Rules", path = "/settings?tab=rules", description = "Auto-categorization rules, condition matching, and tagging" },
                new { title = "Settings: Reminders", path = "/settings?tab=reminders", description = "Desktop notifications and bill due alerts" },
                new { title = "Settings: Privacy", path = "/settings?tab=privacy", description = "Mask amounts and merchant names on screen" },
                new { title = "Settings: Appearance", path = "/settings?tab=appearance", description = "Theme (dark, light, system) and text size scaling" },
                new { title = "Settings: Network", path = "/settings?tab=network", description = "Local Wi-Fi and LAN access from phones and tablets" },
                new { title = "Settings: Profile", path = "/settings?tab=profile", description = "User profile, password change, and user management" },
                new { title = "Settings: Backup", path = "/settings?tab=backup", description = "Download zip backup or restore database" },
                new { title = "Settings: Updates", path = "/settings?tab=updates", description = "Software update checks and version changelogs" }
            };

            var matchedNav = navItems
                .Where(n => ((string)n.title).ToLower().Contains(lower) || ((string)n.description).ToLower().Contains(lower))
                .Take(5)
                .ToList();

            return Ok(new
            {
                transactions = txResults,
                merchants = merchantResults,
                navigation = matchedNav
            });
        }
    }
}
