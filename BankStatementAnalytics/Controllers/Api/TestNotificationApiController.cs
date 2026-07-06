using Microsoft.AspNetCore.Mvc;
using NHibernate.Linq;
using Common.Framework.Data;
using Common.Framework.Web;
using BankStatementAnalytics.Models;
using BankStatementAnalytics.Services;
using System;
using System.Linq;
using System.Threading.Tasks;

namespace BankStatementAnalytics.Controllers.Api
{
    /// <summary>
    /// Test-only helper for previewing how bill reminders surface (sidebar badge, header bell
    /// dropdown, and the desktop toast). Seeds a confirmed bill that is due today so it appears
    /// in <c>GET /api/bills/upcoming</c> immediately, and can clean the test rows up again.
    /// Test match keys are prefixed with "TEST:" so they never collide with detected bills.
    /// </summary>
    [ApiController]
    [Route("api/test")]
    public class TestNotificationApiController : TenantControllerBase
    {
        private const string TestPrefix = "TEST:";

        // GET/POST: api/test/notification — create a sample reminder due today.
        // GET is allowed too so you can trigger it by just visiting the URL in the browser.
        [HttpGet("notification")]
        [HttpPost("notification")]
        public async Task<IActionResult> SeedNotification()
        {
            var today = DateTime.Today;

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var bill = new RecurringBill
            {
                OwnerUserId = CurrentUserId,
                Name = "Test Reminder",
                MatchKey = TestPrefix + Guid.NewGuid().ToString("N"),
                ExpectedAmount = 999m,
                DueDayOfMonth = today.Day,      // due today → shows up in /upcoming right away
                Status = "Confirmed",
                LastSeenDate = today,
                CreatedOn = DateTime.Now,
                UpdatedOn = DateTime.Now
            };

            await session.SaveAsync(bill);
            await tx.CommitAsync();

            var nextDue = RecurringBillService.ProjectDueDate(bill.DueDayOfMonth, today);
            return Ok(new
            {
                bill.Id,
                bill.Name,
                bill.ExpectedAmount,
                bill.DueDayOfMonth,
                nextDueDate = nextDue,
                daysUntilDue = (nextDue - today).Days,
                message = "Sample reminder created. Reload the app to see the header bell badge, the dropdown, and (if reminders are enabled) the desktop notification."
            });
        }

        // DELETE: api/test/notification — remove all seeded test reminders for the current user.
        [HttpDelete("notification")]
        public async Task<IActionResult> ClearNotifications()
        {
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var testBills = session.Query<RecurringBill>()
                .Where(b => b.OwnerUserId == CurrentUserId && b.MatchKey.StartsWith(TestPrefix))
                .ToList();

            foreach (var bill in testBills)
                await session.DeleteAsync(bill);

            await tx.CommitAsync();

            return Ok(new { removed = testBills.Count });
        }
    }
}
