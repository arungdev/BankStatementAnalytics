using Microsoft.AspNetCore.Mvc;
using NHibernate.Linq;
using BankStatementAnalytics.Data;
using BankStatementAnalytics.Dtos;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Controllers
{
    public class CounterPartyController : Controller
    {
        // Controllers/CounterPartyController.cs
        public IActionResult Details(int id)
        {
            using var session = DbHelper.GetSession();

            var cp = session.Query<CounterParty>()
                .Where(x => x.Id == id)
                .FetchMany(x => x.UpiIds)
                .SingleOrDefault();

            if (cp == null) return NotFound();

            // Load all transactions for this counterparty across both banks
            var iobTx = session.Query<IobTransaction>()
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
                Transactions = iobTx.Select(x => new TransactionDto
                {
                    TransactionDate = x.TransactionDate,
                    UpiReference = x.UpiReference,
                    CounterParty = cp.Name,
                    Category = cp.Category,
                    Mode = x.Mode,
                    Debit = x.Debit,
                    Credit = x.Credit,
                    Balance = x.Balance,
                }).ToList()
            };

            return View(dto);
        }
    }
}
