using BankStatementAnalytics.Data;
using BankStatementAnalytics.Dtos;
using BankStatementAnalytics.Mappping;
using BankStatementAnalytics.Models;
using Common.Framework.Data;
using Microsoft.AspNetCore.Mvc;
using NHibernate.Linq;

namespace BankStatementAnalytics.Controllers
{
    public class CounterPartyController : Controller
    {
        public IActionResult Index()
        {
            return NotFound();
        }
        // Controllers/CounterPartyController.cs
        public IActionResult Details(int id)
        {
            using var session = DbHelper.GetSession();

            var cp = session.Query<Merchant>()
                .Where(x => x.Id == id)
                .FetchMany(x => x.UpiIds)
                .SingleOrDefault();

            if (cp == null) return NotFound();

            // Load all transactions for this counterparty across both banks
            var iobTx = session.Query<BankTransaction>()
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
        public async Task<IActionResult> Create(CounterPartyDto dto)
        {
            var cp = new Merchant
            {
                Name = dto.Name,
                FriendlyName = dto.FriendlyName,
                Category = dto.Category,
                SubCategory = dto.SubCategory,
                BankCode = dto.BankCode,
                Notes = dto.Notes,
                CreatedOn = System.DateTime.Now
            };

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();
            session.Save(cp);
            await tx.CommitAsync();

            return RedirectToAction("Index");
        }
    }
}
