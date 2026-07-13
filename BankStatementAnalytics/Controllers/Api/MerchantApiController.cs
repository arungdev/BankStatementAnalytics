using Microsoft.AspNetCore.Mvc;
using NHibernate.Linq;
using Common.Framework.Data;
using Common.Framework.Web;
using BankStatementAnalytics.Dtos;
using BankStatementAnalytics.Models;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System;

namespace BankStatementAnalytics.Controllers.Api
{
    [ApiController]
    [Route("api/merchants")]
    public class MerchantApiController : TenantControllerBase
    {
        // GET: api/merchants
        [HttpGet]
        public IActionResult GetAll()
        {
            using var session = DbHelper.GetSession();

            var merchantEntities = session.Query<Merchant>()
                .Where(x => x.OwnerUserId == CurrentUserId)
                .FetchMany(x => x.UpiIds)
                .ToList();

            // Transaction count per merchant, scoped to this user's merchants (not a scan of
            // every user's transactions).
            var ownedMerchantIds = merchantEntities.Select(m => m.Id).ToHashSet();
            var txCounts = session.Query<BankTransaction>()
                .Where(t => t.CounterParty != null && ownedMerchantIds.Contains(t.CounterParty.Id))
                .GroupBy(t => t.CounterParty.Id)
                .Select(g => new { Id = g.Key, Count = g.Count() })
                .ToList()
                .ToDictionary(x => x.Id, x => x.Count);

            var merchants = merchantEntities
                .Select(merchantEntity => new
                {
                    Id = merchantEntity.Id,
                    Name = merchantEntity.Name,
                    FriendlyName = merchantEntity.FriendlyName,
                    Category = merchantEntity.Category,
                    SubCategory = merchantEntity.SubCategory,
                    UpiIds = merchantEntity.UpiIds.Select(u => u.UpiId).ToList(),
                    Aliases = merchantEntity.Aliases.ToList(),
                    TransactionCount = txCounts.TryGetValue(merchantEntity.Id, out var c) ? c : 0
                })
                .OrderByDescending(m => m.TransactionCount)
                .ThenBy(m => m.FriendlyName ?? m.Name)
                .ToList();

            return Ok(merchants);
        }

        // GET: api/merchants/{id}
        [HttpGet("{id}")]
        public IActionResult GetById(int id)
        {
            using var session = DbHelper.GetSession();

            var merchantEntity = session.Query<Merchant>()
                .Where(x => x.Id == id)
                .FetchMany(x => x.UpiIds)
                .SingleOrDefault();

            if (!Owns(merchantEntity))
                return NotFound();

            var transactions = session.Query<BankTransaction>()
                .Where(x => x.CounterParty != null && x.CounterParty.Id == id)
                .ToList();

            var allTransactions = transactions
                .Select(x => new
                {
                    TransactionDate = x.TransactionDate,
                    UpiReference = x.UpiReference,
                    Merchant = merchantEntity.Name,
                    Category = merchantEntity.Category,
                    Mode = x.Mode,
                    Debit = x.Debit,
                    Credit = x.Credit,
                    Balance = x.Balance,
                    Description = x.Description,
                    BankType = x.BankType
                })
                .OrderByDescending(t => t.TransactionDate)
                .ToList();

            var dto = new
            {
                Id = merchantEntity.Id,
                Name = merchantEntity.Name,
                FriendlyName = merchantEntity.FriendlyName,
                Category = merchantEntity.Category,
                SubCategory = merchantEntity.SubCategory,
                BankCode = merchantEntity.BankCode,
                Notes = merchantEntity.Notes,
                UpiIds = merchantEntity.UpiIds.Select(u => u.UpiId).ToList(),
                Aliases = merchantEntity.Aliases.ToList(),
                Transactions = allTransactions
            };

            return Ok(dto);
        }

        // PUT: api/merchants/{id}
        [HttpPut("{id}")]
        public async Task<IActionResult> Update(int id, [FromBody] UpdateMerchantRequest request)
        {
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var merchantEntity = session.Get<Merchant>(id);
            if (!Owns(merchantEntity))
                return NotFound();

            merchantEntity.Category = request.Category;
            merchantEntity.SubCategory = request.SubCategory;
            merchantEntity.UpdatedOn = DateTime.Now;

            await session.UpdateAsync(merchantEntity);
            await tx.CommitAsync();

            return NoContent();
        }

        // POST: api/merchants/merge
        [HttpPost("merge")]
        public async Task<IActionResult> Merge([FromBody] MergeMerchantsRequest request)
        {
            if (request == null || request.SecondaryIds == null || !request.SecondaryIds.Any())
                return BadRequest("Invalid request.");

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var primary = session.Query<Merchant>()
                .FetchMany(c => c.UpiIds)
                .SingleOrDefault(c => c.Id == request.PrimaryId);

            if (!Owns(primary)) return NotFound("Primary merchant not found.");

            foreach (var secId in request.SecondaryIds)
            {
                if (secId == request.PrimaryId) continue;

                var secondary = session.Query<Merchant>()
                    .FetchMany(c => c.UpiIds)
                    .SingleOrDefault(c => c.Id == secId);

                if (!Owns(secondary)) continue;

                // Remember the secondary's name so we don't recreate it on future uploads!
                if (!primary.Aliases.Contains(secondary.Name))
                {
                    primary.Aliases.Add(secondary.Name);
                }

                // Copy over any existing aliases the secondary had
                foreach (var alias in secondary.Aliases)
                {
                    if (!primary.Aliases.Contains(alias))
                    {
                        primary.Aliases.Add(alias);
                    }
                }

                // Copy unique UPI IDs to primary
                foreach (var upi in secondary.UpiIds.ToList())
                {
                    if (!primary.UpiIds.Any(u => string.Equals(u.UpiId, upi.UpiId, System.StringComparison.OrdinalIgnoreCase)))
                    {
                        var newUpi = new MerchantUpi
                        {
                            CounterParty = primary,
                            UpiId = upi.UpiId,
                            CreatedOn = upi.CreatedOn
                        };
                        primary.UpiIds.Add(newUpi);
                        await session.SaveAsync(newUpi);
                    }
                }
                // No need to clear secondary.UpiIds or delete them manually;
                // NHibernate's Cascade.All will delete them when we delete secondary.

                // Reassign transactions to primary in one bulk UPDATE rather than loading and
                // updating each row. Runs directly against the DB (single unified table).
                await session.CreateQuery(
                        "update BankTransaction set CounterParty = :primary where CounterParty.Id = :secId")
                    .SetParameter("primary", primary)
                    .SetParameter("secId", secId)
                    .ExecuteUpdateAsync();

                await session.DeleteAsync(secondary);
            }

            await session.UpdateAsync(primary);
            await tx.CommitAsync();

            return Ok();
        }

        // POST: api/merchants/unmerge
        [HttpPost("unmerge")]
        public async Task<IActionResult> Unmerge([FromBody] UnmergeRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.AliasName))
                return BadRequest("Invalid request.");

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var primary = session.Get<Merchant>(request.PrimaryId);
            if (!Owns(primary)) return NotFound("Primary merchant not found.");

            // Find and remove alias safely (handling potential trailing spaces)
            var aliasToRemove = primary.Aliases.FirstOrDefault(a => a != null && a.Trim().Equals(request.AliasName.Trim(), StringComparison.OrdinalIgnoreCase));
            if (aliasToRemove != null)
            {
                // Remove ALL instances of this alias if duplicates exist
                while (primary.Aliases.Contains(aliasToRemove))
                {
                    primary.Aliases.Remove(aliasToRemove);
                }
            }
            else
            {
                return BadRequest("Alias not found on this merchant.");
            }

            // Create new separated merchant
            var newCp = new Merchant
            {
                Name = request.AliasName,
                BankCode = primary.BankCode,
                OwnerUserId = primary.OwnerUserId,
                CreatedOn = DateTime.Now
            };
            await session.SaveAsync(newCp);

            var searchAlias = request.AliasName.Trim();
            var movedTxs = new List<BankTransaction>();

            // Re-assign transactions matched by string back to the unmerged entity
            var txs = session.Query<BankTransaction>().Where(t => t.CounterParty != null && t.CounterParty.Id == primary.Id).ToList();
            foreach (var t in txs)
            {
                if ((t.Description != null && t.Description.Contains(searchAlias, StringComparison.OrdinalIgnoreCase)) ||
                    (t.UpiReference != null && t.UpiReference.Contains(searchAlias, StringComparison.OrdinalIgnoreCase)))
                {
                    t.CounterParty = newCp;
                    await session.UpdateAsync(t);
                    movedTxs.Add(t);
                }
            }

            // Restore UPI IDs that appear in the restored transactions
            foreach (var upi in primary.UpiIds.ToList())
            {
                bool matchesMovedTxs = movedTxs.Any(t =>
                    (t.Description != null && t.Description.Contains(upi.UpiId, StringComparison.OrdinalIgnoreCase)) ||
                    (t.Narration != null && t.Narration.Contains(upi.UpiId, StringComparison.OrdinalIgnoreCase)) ||
                    (t.UpiVpa != null && string.Equals(t.UpiVpa, upi.UpiId, StringComparison.OrdinalIgnoreCase)));

                if (matchesMovedTxs)
                {
                    var newUpi = new MerchantUpi
                    {
                        CounterParty = newCp,
                        UpiId = upi.UpiId,
                        CreatedOn = upi.CreatedOn
                    };
                    newCp.UpiIds.Add(newUpi);
                    await session.SaveAsync(newUpi);

                    primary.UpiIds.Remove(upi);
                    await session.DeleteAsync(upi);
                }
            }

            await session.UpdateAsync(primary);
            await tx.CommitAsync();

            return Ok();
        }
    }

    public class UpdateMerchantRequest
    {
        public string? Category { get; set; }
        public string? SubCategory { get; set; }
    }

    public class MergeMerchantsRequest
    {
        public int PrimaryId { get; set; }
        public List<int> SecondaryIds { get; set; } = new List<int>();
    }

    public class UnmergeRequest
    {
        public int PrimaryId { get; set; }
        public string AliasName { get; set; } = string.Empty;
    }
}
