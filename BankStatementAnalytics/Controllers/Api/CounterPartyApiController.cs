using Microsoft.AspNetCore.Mvc;
using NHibernate.Linq;
using BankStatementAnalytics.Data;
using BankStatementAnalytics.Dtos;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Controllers.Api
{
    [ApiController]
    [Route("api/counterparties")]
    public class CounterPartyApiController : ControllerBase
    {
        // GET: api/counterparties/{id}
        [HttpGet("{id}")]
        public IActionResult GetById(int id)
        {
            using var session = DbHelper.GetSession();

            var cp = session.Query<CounterParty>()
                .Where(x => x.Id == id)
                .FetchMany(x => x.UpiIds)
                .SingleOrDefault();

            if (cp == null)
                return NotFound();

            var transactions = session.Query<IobTransaction>()
                .Where(x => x.CounterParty.Id == id)
                .OrderByDescending(x => x.TransactionDate)
                .ToList();

            var dto = new CounterPartyDto
            {
                Id = cp.Id,
                Name = cp.Name,
                FriendlyName = cp.FriendlyName,
                Category = cp.Category,
                SubCategory = cp.SubCategory,
                BankCode = cp.BankCode,
                Notes = cp.Notes,
                UpiIds = cp.UpiIds.Select(u => u.UpiId).ToList(),
                Transactions = transactions.Select(x => new TransactionDto
                {
                    TransactionDate = x.TransactionDate,
                    UpiReference = x.UpiReference,
                    CounterParty = cp.Name,
                    Category = cp.Category,
                    Mode = x.Mode,
                    Debit = x.Debit,
                    Credit = x.Credit,
                    Balance = x.Balance
                }).ToList()
            };

            return Ok(dto);
        }
    }
}