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
    [Route("api/deposits")]
    public class DepositsApiController : TenantControllerBase
    {
        private readonly DepositService _service;

        public DepositsApiController(DepositService service)
        {
            _service = service;
        }

        // GET: api/deposits — RD/FD investments detected from transactions, merged with saved
        // metadata, plus roll-up totals.
        [HttpGet]
        public IActionResult GetSummary()
        {
            return Ok(_service.GetSummary(CurrentUserId));
        }

        // GET: api/deposits/transactions?kind=RD&matchKey=... — the transactions behind one deposit.
        [HttpGet("transactions")]
        public IActionResult GetTransactions([FromQuery] string kind, [FromQuery] string matchKey)
        {
            if (string.IsNullOrWhiteSpace(matchKey))
                return BadRequest("matchKey is required.");

            return Ok(_service.GetTransactions(CurrentUserId, kind ?? "RD", matchKey));
        }

        // PUT: api/deposits — save/update the editable metadata (nickname, rate, maturity, tenure,
        // note) for a detected deposit, keyed by kind + matchKey.
        [HttpPut]
        public async Task<IActionResult> Save([FromBody] DepositDto req)
        {
            if (req == null || string.IsNullOrWhiteSpace(req.MatchKey) || string.IsNullOrWhiteSpace(req.Kind))
                return BadRequest("kind and matchKey are required.");

            var kind = req.Kind.Trim().ToUpperInvariant();
            if (kind != "RD" && kind != "FD")
                return BadRequest("kind must be RD or FD.");

            var matchKey = req.MatchKey.Trim();

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var deposit = session.Query<Deposit>()
                .FirstOrDefault(d => d.OwnerUserId == CurrentUserId && d.Kind == kind && d.MatchKey == matchKey);

            if (deposit == null)
            {
                deposit = new Deposit
                {
                    OwnerUserId = CurrentUserId,
                    Kind = kind,
                    MatchKey = matchKey,
                    CreatedOn = DateTime.Now,
                };
            }

            deposit.Nickname = string.IsNullOrWhiteSpace(req.Nickname) ? null : req.Nickname.Trim();
            deposit.InterestRate = req.InterestRate;
            deposit.MaturityDate = req.MaturityDate;
            deposit.TermMonths = req.TermMonths is > 0 ? req.TermMonths : null;
            deposit.Note = string.IsNullOrWhiteSpace(req.Note) ? null : req.Note.Trim();
            deposit.UpdatedOn = DateTime.Now;

            await session.SaveOrUpdateAsync(deposit);
            await tx.CommitAsync();

            return Ok(new { deposit.Id });
        }

        // DELETE: api/deposits?kind=RD&matchKey=... — drop saved metadata, reverting to detected defaults.
        [HttpDelete]
        public async Task<IActionResult> Delete([FromQuery] string kind, [FromQuery] string matchKey)
        {
            if (string.IsNullOrWhiteSpace(matchKey) || string.IsNullOrWhiteSpace(kind))
                return BadRequest("kind and matchKey are required.");

            kind = kind.Trim().ToUpperInvariant();
            matchKey = matchKey.Trim();

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var deposit = session.Query<Deposit>()
                .FirstOrDefault(d => d.OwnerUserId == CurrentUserId && d.Kind == kind && d.MatchKey == matchKey);
            if (deposit == null)
                return NoContent();

            await session.DeleteAsync(deposit);
            await tx.CommitAsync();

            return NoContent();
        }
    }

    public class DepositDto
    {
        public string Kind { get; set; } = string.Empty;
        public string MatchKey { get; set; } = string.Empty;
        public string? Nickname { get; set; }
        public decimal? InterestRate { get; set; }
        public DateTime? MaturityDate { get; set; }
        public int? TermMonths { get; set; }
        public string? Note { get; set; }
    }
}
