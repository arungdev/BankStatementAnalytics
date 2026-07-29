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
    [Route("api/reports")]
    public class ReportsApiController : TenantControllerBase
    {
        private readonly ReportService _reports;
        private readonly ReportPdfService _pdf;

        public ReportsApiController(ReportService reports, ReportPdfService pdf)
        {
            _reports = reports;
            _pdf = pdf;
        }

        // GET: api/reports?type=month&year=2026&month=7&accountIds=1,2
        // GET: api/reports?type=year&year=2026&accountIds=1,2
        [HttpGet]
        public async Task<IActionResult> GetReport(
            [FromQuery] string type,
            [FromQuery] int year,
            [FromQuery] int month = 0,
            [FromQuery] string accountIds = null)
        {
            var yearly = string.Equals(type, "year", StringComparison.OrdinalIgnoreCase);
            if (!yearly && !string.Equals(type, "month", StringComparison.OrdinalIgnoreCase))
                return BadRequest("type must be 'month' or 'year'.");
            if (year < 1970 || year > 2100)
                return BadRequest("year is out of range.");
            if (!yearly && (month < 1 || month > 12))
                return BadRequest("month must be between 1 and 12.");
            if (string.IsNullOrWhiteSpace(accountIds))
                return BadRequest("accountIds is required.");

            var ownedIds = await AccountAccess.OwnedIdSetAsync(CurrentUserId);
            var ids = AccountAccess.FilterOwned(accountIds, ownedIds);

            if (!ids.Any())
                return BadRequest("No valid accountIds provided.");

            var report = await _reports.BuildAsync(CurrentUserId, ids, yearly, year, month);
            return Ok(report);
        }

        // GET: api/reports/pdf?type=month&year=2026&month=7&accountIds=1,2
        // Same parameters as GET api/reports, but renders the report as a downloadable PDF.
        [HttpGet("pdf")]
        public async Task<IActionResult> GetReportPdf(
            [FromQuery] string type,
            [FromQuery] int year,
            [FromQuery] int month = 0,
            [FromQuery] string accountIds = null)
        {
            var yearly = string.Equals(type, "year", StringComparison.OrdinalIgnoreCase);
            if (!yearly && !string.Equals(type, "month", StringComparison.OrdinalIgnoreCase))
                return BadRequest("type must be 'month' or 'year'.");
            if (year < 1970 || year > 2100)
                return BadRequest("year is out of range.");
            if (!yearly && (month < 1 || month > 12))
                return BadRequest("month must be between 1 and 12.");
            if (string.IsNullOrWhiteSpace(accountIds))
                return BadRequest("accountIds is required.");

            var ownedIds = await AccountAccess.OwnedIdSetAsync(CurrentUserId);
            var ids = AccountAccess.FilterOwned(accountIds, ownedIds);

            if (!ids.Any())
                return BadRequest("No valid accountIds provided.");

            var report = await _reports.BuildAsync(CurrentUserId, ids, yearly, year, month);

            // Scope line under the PDF title — a single account shows "HDFC ****1234",
            // anything wider mirrors the page's "All accounts" label.
            string scopeLabel;
            if (ids.Count == 1)
            {
                using var session = DbHelper.GetSession();
                var account = await session.GetAsync<Account>(ids[0]);
                scopeLabel = account != null
                    ? $"{account.BankName} {account.MaskedAccountNumber}".Trim()
                    : "1 account";
            }
            else
            {
                scopeLabel = ids.Count == ownedIds.Count ? "All accounts" : $"{ids.Count} accounts";
            }

            var bytes = _pdf.Render(report, scopeLabel);
            var fileName = $"{report.Label} {(yearly ? "Annual" : "Monthly")} Report.pdf";
            return File(bytes, "application/pdf", fileName);
        }

        // GET: api/reports/transactions?type=month&year=2026&month=7&accountIds=1,2&kind=spend
        // The rows behind a summary tile, for the Reports page's drill-down drawer. Same period
        // and account parameters as GET api/reports; kind is "income", "spend", or omitted/"all".
        [HttpGet("transactions")]
        public async Task<IActionResult> GetReportTransactions(
            [FromQuery] string type,
            [FromQuery] int year,
            [FromQuery] int month = 0,
            [FromQuery] string accountIds = null,
            [FromQuery] string kind = null)
        {
            var yearly = string.Equals(type, "year", StringComparison.OrdinalIgnoreCase);
            if (!yearly && !string.Equals(type, "month", StringComparison.OrdinalIgnoreCase))
                return BadRequest("type must be 'month' or 'year'.");
            if (year < 1970 || year > 2100)
                return BadRequest("year is out of range.");
            if (!yearly && (month < 1 || month > 12))
                return BadRequest("month must be between 1 and 12.");
            if (string.IsNullOrWhiteSpace(accountIds))
                return BadRequest("accountIds is required.");

            var ownedIds = await AccountAccess.OwnedIdSetAsync(CurrentUserId);
            var ids = AccountAccess.FilterOwned(accountIds, ownedIds);

            if (!ids.Any())
                return BadRequest("No valid accountIds provided.");

            var rows = await _reports.GetTransactionsAsync(ids, yearly, year, month, kind?.ToLowerInvariant());
            return Ok(rows);
        }

        // GET: api/reports/periods — every calendar month and year from the user's earliest
        // transaction to now, newest first, so the client can offer month/year pickers.
        [HttpGet("periods")]
        public async Task<IActionResult> GetPeriods()
        {
            using var session = DbHelper.GetSession();

            var ownedIds = AccountAccess.OwnedIdSet(session, CurrentUserId);

            var now = DateTime.Now;
            var currentStart = new DateTime(now.Year, now.Month, 1);

            DateTime? earliest = null;
            if (ownedIds.Count > 0)
            {
                earliest = await session.Query<BankTransaction>()
                    .Where(t => ownedIds.Contains(t.AccountId))
                    .Select(t => (DateTime?)(t.EffectiveDate ?? t.TransactionDate))
                    .MinAsync();
            }

            // Always include the current month; extend back to the earliest transaction if any.
            var earliestStart = earliest.HasValue
                ? new DateTime(earliest.Value.Year, earliest.Value.Month, 1)
                : currentStart;

            var months = new List<object>();
            var years = new List<int>();
            for (var m = currentStart; m >= earliestStart; m = m.AddMonths(-1))
            {
                months.Add(new { year = m.Year, month = m.Month, label = m.ToString("MMMM yyyy") });
                if (!years.Contains(m.Year))
                    years.Add(m.Year);
            }

            return Ok(new { months, years });
        }
    }
}
