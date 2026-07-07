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
    [ApiController]
    [Route("api/bills")]
    public class BillsApiController : TenantControllerBase
    {
        private readonly RecurringBillService _service;

        public BillsApiController(RecurringBillService service)
        {
            _service = service;
        }

        // GET: api/bills — confirmed bills with projected next due date / paid status.
        [HttpGet]
        public IActionResult GetBills()
        {
            return Ok(_service.GetConfirmedBillViews(CurrentUserId));
        }

        // GET: api/bills/upcoming?withinDays=7 — unpaid bills due within the window (badge + reminders).
        [HttpGet("upcoming")]
        public IActionResult GetUpcoming([FromQuery] int withinDays = 7)
        {
            return Ok(_service.GetConfirmedBillViews(CurrentUserId, upcomingOnly: true, withinDays: withinDays));
        }

        // GET: api/bills/suggestions — auto-detected candidates not yet confirmed/dismissed.
        [HttpGet("suggestions")]
        public IActionResult GetSuggestions()
        {
            return Ok(_service.DetectCandidates(CurrentUserId));
        }

        // GET: api/bills/{id}/transactions — the historical debits that make up this bill.
        [HttpGet("{id}/transactions")]
        public IActionResult GetBillTransactions(int id)
        {
            var bill = DbHelper.GetById<RecurringBill>(id);
            if (!Owns(bill)) return NotFound();

            return Ok(_service.GetMatchingTransactions(CurrentUserId, bill));
        }

        // POST: api/bills/suggestion-transactions — historical debits behind an unconfirmed
        // suggestion (no bill row exists yet, so it's matched by key + expected amount).
        [HttpPost("suggestion-transactions")]
        public IActionResult GetSuggestionTransactions([FromBody] BillDto req)
        {
            if (req == null || string.IsNullOrWhiteSpace(req.MatchKey))
                return BadRequest("matchKey is required.");

            var probe = new RecurringBill
            {
                OwnerUserId = CurrentUserId,
                MatchKey = req.MatchKey.Trim(),
                ExpectedAmount = req.ExpectedAmount
            };

            return Ok(_service.GetMatchingTransactions(CurrentUserId, probe));
        }

        // POST: api/bills — confirm a suggestion or add a bill manually.
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] BillDto req)
        {
            if (req == null || string.IsNullOrWhiteSpace(req.Name) || string.IsNullOrWhiteSpace(req.MatchKey))
                return BadRequest("Name and matchKey are required.");

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var bill = new RecurringBill
            {
                OwnerUserId = CurrentUserId,
                Name = req.Name.Trim(),
                MatchKey = req.MatchKey.Trim(),
                ExpectedAmount = req.ExpectedAmount,
                DueDayOfMonth = Math.Clamp(req.DueDayOfMonth, 1, 31),
                Status = "Confirmed",
                LastSeenDate = req.LastSeenDate,
                CreatedOn = DateTime.Now,
                UpdatedOn = DateTime.Now
            };

            if (req.CounterPartyId.HasValue)
            {
                var merchant = session.Get<Merchant>(req.CounterPartyId.Value);
                if (Owns(merchant))
                    bill.CounterParty = merchant;
            }

            await session.SaveAsync(bill);
            await tx.CommitAsync();

            return Ok(new { bill.Id });
        }

        // POST: api/bills/dismiss — remember a dismissed suggestion so it stops reappearing.
        [HttpPost("dismiss")]
        public async Task<IActionResult> Dismiss([FromBody] BillDto req)
        {
            if (req == null || string.IsNullOrWhiteSpace(req.MatchKey))
                return BadRequest("matchKey is required.");

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var matchKey = req.MatchKey.Trim();
            var existing = session.Query<RecurringBill>()
                .FirstOrDefault(b => b.OwnerUserId == CurrentUserId && b.MatchKey == matchKey);
            if (existing != null)
                return NoContent();

            var dismissed = new RecurringBill
            {
                OwnerUserId = CurrentUserId,
                Name = string.IsNullOrWhiteSpace(req.Name) ? matchKey : req.Name.Trim(),
                MatchKey = matchKey,
                ExpectedAmount = req.ExpectedAmount,
                DueDayOfMonth = Math.Clamp(req.DueDayOfMonth, 1, 31),
                Status = "Dismissed",
                CreatedOn = DateTime.Now,
                UpdatedOn = DateTime.Now
            };

            await session.SaveAsync(dismissed);
            await tx.CommitAsync();

            return NoContent();
        }

        // PUT: api/bills/{id} — edit a confirmed bill (name, amount, due day).
        [HttpPut("{id}")]
        public async Task<IActionResult> Update(int id, [FromBody] BillDto req)
        {
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var bill = session.Get<RecurringBill>(id);
            if (!Owns(bill)) return NotFound();

            if (!string.IsNullOrWhiteSpace(req.Name)) bill.Name = req.Name.Trim();
            bill.ExpectedAmount = req.ExpectedAmount;
            bill.DueDayOfMonth = Math.Clamp(req.DueDayOfMonth, 1, 31);
            bill.UpdatedOn = DateTime.Now;

            await session.UpdateAsync(bill);
            await tx.CommitAsync();

            return NoContent();
        }

        // DELETE: api/bills/{id}
        [HttpDelete("{id}")]
        public async Task<IActionResult> Delete(int id)
        {
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var bill = session.Get<RecurringBill>(id);
            if (!Owns(bill)) return NotFound();

            await session.DeleteAsync(bill);
            await tx.CommitAsync();

            return NoContent();
        }
    }

    public class BillDto
    {
        public string Name { get; set; } = string.Empty;
        public string MatchKey { get; set; } = string.Empty;
        public int? CounterPartyId { get; set; }
        public decimal ExpectedAmount { get; set; }
        public int DueDayOfMonth { get; set; }
        public DateTime? LastSeenDate { get; set; }
    }
}
