using Microsoft.AspNetCore.Mvc;
using NHibernate.Linq;
using Common.Framework.Data;
using Common.Framework.Web;
using BankStatementAnalytics.Models;
using BankStatementAnalytics.Services;
using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace BankStatementAnalytics.Controllers.Api
{
    [ApiController]
    [Route("api/export")]
    public class ExportApiController : TenantControllerBase
    {
        // GET: api/export/transactions?accountId=1&accountIds=1,2&startDate=...&endDate=...&format=csv
        [HttpGet("transactions")]
        public async Task<IActionResult> ExportTransactions(
            [FromQuery] int accountId,
            [FromQuery] string? accountIds = null,
            [FromQuery] DateTime? startDate = null,
            [FromQuery] DateTime? endDate = null,
            [FromQuery] string? category = null,
            [FromQuery] string? kind = null,
            [FromQuery] string? search = null)
        {
            using var session = DbHelper.GetSession();

            var ownedIds = AccountAccess.OwnedIdSet(session, CurrentUserId);
            var (status, ids) = AccountAccess.ResolveScope(ownedIds, accountIds, accountId);
            if (status == AccountAccess.ScopeStatus.NotFound)
                return NotFound();
            if (ids.Count == 0)
                return BadRequest("No accessible accounts selected.");

            var query = session.Query<BankTransaction>()
                .ExcludeOwnMoneyMoves()
                .Where(t => ids.Contains(t.AccountId));

            if (startDate.HasValue)
            {
                var start = startDate.Value.Date;
                query = query.Where(t => (t.EffectiveDate ?? t.TransactionDate) >= start);
            }
            if (endDate.HasValue)
            {
                var endExclusive = endDate.Value.Date.AddDays(1);
                query = query.Where(t => (t.EffectiveDate ?? t.TransactionDate) < endExclusive);
            }

            if (!string.IsNullOrWhiteSpace(kind))
            {
                query = kind.ToLowerInvariant() switch
                {
                    "spend" => query.Where(t => t.Debit > 0),
                    "income" => query.Where(t => t.Credit > 0),
                    _ => query
                };
            }

            if (!string.IsNullOrWhiteSpace(category))
            {
                var cat = category.Trim();
                query = query.Where(t =>
                    t.CategoryOverride == cat ||
                    (t.CategoryOverride == null && t.CounterParty != null && t.CounterParty.Category == cat));
            }

            if (!string.IsNullOrWhiteSpace(search))
            {
                var q = search.Trim().ToLowerInvariant();
                query = query.Where(t =>
                    (t.Description != null && t.Description.ToLower().Contains(q)) ||
                    (t.Narration != null && t.Narration.ToLower().Contains(q)) ||
                    (t.CounterParty != null && t.CounterParty.Name != null && t.CounterParty.Name.ToLower().Contains(q)) ||
                    (t.Note != null && t.Note.ToLower().Contains(q)) ||
                    (t.Tags != null && t.Tags.ToLower().Contains(q)));
            }

            var rows = await query
                .OrderByDescending(t => t.TransactionDate)
                .Select(t => new
                {
                    Date = t.EffectiveDate ?? t.TransactionDate,
                    t.AccountId,
                    t.BankType,
                    t.BankReference,
                    t.Description,
                    Merchant = t.CounterParty != null ? t.CounterParty.Name : null,
                    Category = t.CategoryOverride ?? (t.CounterParty != null ? t.CounterParty.Category : null),
                    SubCategory = t.SubCategoryOverride ?? (t.CounterParty != null ? t.CounterParty.SubCategory : null),
                    t.Debit,
                    t.Credit,
                    t.Balance,
                    t.Mode,
                    t.UpiReference,
                    t.Tags,
                    t.Note
                })
                .ToListAsync();

            var accounts = await session.Query<Account>()
                .Where(a => ids.Contains(a.Id))
                .ToListAsync();
            var accountMap = accounts.ToDictionary(a => a.Id, a => $"{a.BankName} ({a.MaskedAccountNumber})");

            var sb = new StringBuilder();
            // UTF-8 BOM so Excel opens it with proper encoding
            sb.Append('\uFEFF');

            // Header row
            sb.AppendLine("Date,Account,Bank,Bank Reference,Description,Merchant,Category,Sub Category,Debit (Spends),Credit (Income),Balance,Mode,UPI Reference,Tags,Note");

            foreach (var r in rows)
            {
                accountMap.TryGetValue(r.AccountId, out var accName);
                sb.AppendLine(string.Join(",",
                    EscapeCsv(r.Date.ToString("yyyy-MM-dd")),
                    EscapeCsv(accName ?? r.AccountId.ToString()),
                    EscapeCsv(r.BankType),
                    EscapeCsv(r.BankReference),
                    EscapeCsv(r.Description),
                    EscapeCsv(r.Merchant),
                    EscapeCsv(r.Category),
                    EscapeCsv(r.SubCategory),
                    r.Debit.ToString("0.00"),
                    r.Credit.ToString("0.00"),
                    r.Balance.ToString("0.00"),
                    EscapeCsv(r.Mode),
                    EscapeCsv(r.UpiReference),
                    EscapeCsv(r.Tags),
                    EscapeCsv(r.Note)
                ));
            }

            var filename = $"transactions_{DateTime.Today:yyyy-MM-dd}.csv";
            var bytes = Encoding.UTF8.GetBytes(sb.ToString());
            return File(bytes, "text/csv; charset=utf-8", filename);
        }

        private static string EscapeCsv(string? value)
        {
            if (string.IsNullOrEmpty(value)) return "";
            if (value.Contains(',') || value.Contains('"') || value.Contains('\n') || value.Contains('\r'))
            {
                return $"\"{value.Replace("\"", "\"\"")}\"";
            }
            return value;
        }
    }
}
