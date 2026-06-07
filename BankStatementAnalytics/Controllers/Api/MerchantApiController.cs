using Microsoft.AspNetCore.Mvc;
using NHibernate.Linq;
using Common.Framework.Data;
using BankStatementAnalytics.Dtos;
using BankStatementAnalytics.Models;
using System.Collections.Generic;
using System.Threading.Tasks;
using System;
using Common.Framework.Logging;

namespace BankStatementAnalytics.Controllers.Api
{
    [ApiController]
    [Route("api/merchants")]
    public class MerchantApiController : ControllerBase
    {
        // GET: api/merchants
        [HttpGet]
        public IActionResult GetAll()
        {
            try
            {
                using var session = DbHelper.GetSession();

                var merchants = session.Query<Merchant>()
                    .FetchMany(x => x.UpiIds)
                    .ToList()
                    .Select(merchantEntity => new
                    {
                        Id = merchantEntity.Id,
                        Name = merchantEntity.Name,
                        Category = merchantEntity.Category,
                        UpiIds = merchantEntity.UpiIds.Select(u => u.UpiId).ToList(),
                        Aliases = merchantEntity.Aliases.ToList()
                    }).ToList();

                return Ok(merchants);
            }
            catch (Exception ex)
            {
                Log.Exception(ex);
                return StatusCode(500, "Internal server error");
            }
        }

        // GET: api/merchants/{id}
        [HttpGet("{id}")]
        public IActionResult GetById(int id)
        {
            try
            {
                using var session = DbHelper.GetSession();

                var merchantEntity = session.Query<Merchant>()
                    .Where(x => x.Id == id)
                    .FetchMany(x => x.UpiIds)
                    .SingleOrDefault();

                if (merchantEntity == null)
                    return NotFound();

                var iobTransactions = session.Query<IobTransaction>()
                    .Where(x => x.CounterParty != null && x.CounterParty.Id == id)
                    .ToList();

                var hdfcTransactions = session.Query<HdfcTransaction>()
                    .Where(x => x.CounterParty != null && x.CounterParty.Id == id)
                    .ToList();

                var iobMapped = iobTransactions.Select(x => new
                {
                    TransactionDate = x.TransactionDate,
                    UpiReference = x.UpiReference,
                    Merchant = merchantEntity.Name,
                    Category = merchantEntity.Category,
                    Mode = x.Mode,
                    Debit = x.Debit,
                    Credit = x.Credit,
                    Balance = x.Balance,
                    Description = x.Description
                });

                var hdfcMapped = hdfcTransactions.Select(x => new
                {
                    TransactionDate = x.TransactionDate,
                    UpiReference = x.UpiReference,
                    Merchant = merchantEntity.Name,
                    Category = merchantEntity.Category,
                    Mode = x.Mode,
                    Debit = x.Debit,
                    Credit = x.Credit,
                    Balance = x.Balance,
                    Description = x.Description
                });

                var allTransactions = iobMapped.Concat(hdfcMapped).OrderByDescending(t => t.TransactionDate).ToList();

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
            catch (Exception ex)
            {
                Log.Exception(ex);
                return StatusCode(500, "Internal server error");
            }
        }

        // PUT: api/merchants/{id}
        [HttpPut("{id}")]
        public async Task<IActionResult> Update(int id, [FromBody] UpdateMerchantRequest request)
        {
            try
            {
                using var session = DbHelper.GetSession();
                using var tx = session.BeginTransaction();

                var merchantEntity = session.Get<Merchant>(id);
                if (merchantEntity == null)
                    return NotFound();

                merchantEntity.Category = request.Category;
                merchantEntity.SubCategory = request.SubCategory;
                merchantEntity.UpdatedOn = DateTime.Now;

                await session.UpdateAsync(merchantEntity);
                await tx.CommitAsync();

                return NoContent();
            }
            catch (Exception ex)
            {
                Log.Exception(ex);
                return StatusCode(500, "Internal server error");
            }
        }

        // POST: api/merchants/merge
        [HttpPost("merge")]
        public async Task<IActionResult> Merge([FromBody] MergeMerchantsRequest request)
        {
            try
            {
                if (request == null || request.SecondaryIds == null || !request.SecondaryIds.Any())
                    return BadRequest("Invalid request.");

                using var session = DbHelper.GetSession();
                using var tx = session.BeginTransaction();

                var primary = session.Query<Merchant>()
                    .FetchMany(c => c.UpiIds)
                    .SingleOrDefault(c => c.Id == request.PrimaryId);

                if (primary == null) return NotFound("Primary merchant not found.");

                foreach (var secId in request.SecondaryIds)
                {
                    if (secId == request.PrimaryId) continue;

                    var secondary = session.Query<Merchant>()
                        .FetchMany(c => c.UpiIds)
                        .SingleOrDefault(c => c.Id == secId);

                    if (secondary == null) continue;

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

                    // Reassign Transactions to primary
                    var iobTxs = session.Query<IobTransaction>().Where(t => t.CounterParty != null && t.CounterParty.Id == secId).ToList();
                    foreach (var t in iobTxs)
                    {
                        t.CounterParty = primary;
                        await session.UpdateAsync(t);
                    }

                    var hdfcTxs = session.Query<HdfcTransaction>().Where(t => t.CounterParty != null && t.CounterParty.Id == secId).ToList();
                    foreach (var t in hdfcTxs)
                    {
                        t.CounterParty = primary;
                        await session.UpdateAsync(t);
                    }

                    await session.DeleteAsync(secondary);
                }

                await session.UpdateAsync(primary);
                await tx.CommitAsync();

                return Ok();
            }
            catch (Exception ex)
            {
                Log.Exception(ex);
                return StatusCode(500, "Internal server error");
            }
        }

        // POST: api/merchants/unmerge
        [HttpPost("unmerge")]
        public async Task<IActionResult> Unmerge([FromBody] UnmergeRequest request)
        {
            try
            {
                if (request == null || string.IsNullOrWhiteSpace(request.AliasName))
                    return BadRequest("Invalid request.");

                using var session = DbHelper.GetSession();
                using var tx = session.BeginTransaction();

                var primary = session.Get<Merchant>(request.PrimaryId);
                if (primary == null) return NotFound("Primary merchant not found.");

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
                    CreatedOn = DateTime.Now
                };
                await session.SaveAsync(newCp);

                var searchAlias = request.AliasName.Trim();
                var movedIobTxs = new List<IobTransaction>();
                var movedHdfcTxs = new List<HdfcTransaction>();

                // Re-assign transactions matched by string back to the unmerged entity
                var iobTxs = session.Query<IobTransaction>().Where(t => t.CounterParty != null && t.CounterParty.Id == primary.Id).ToList();
                foreach (var t in iobTxs)
                {
                    if ((t.Description != null && t.Description.Contains(searchAlias, StringComparison.OrdinalIgnoreCase)) || 
                        (t.UpiReference != null && t.UpiReference.Contains(searchAlias, StringComparison.OrdinalIgnoreCase)))
                    {
                        t.CounterParty = newCp;
                        await session.UpdateAsync(t);
                        movedIobTxs.Add(t);
                    }
                }

                var hdfcTxs = session.Query<HdfcTransaction>().Where(t => t.CounterParty != null && t.CounterParty.Id == primary.Id).ToList();
                foreach (var t in hdfcTxs)
                {
                    if ((t.Description != null && t.Description.Contains(searchAlias, StringComparison.OrdinalIgnoreCase)) || 
                        (t.UpiReference != null && t.UpiReference.Contains(searchAlias, StringComparison.OrdinalIgnoreCase)))
                    {
                        t.CounterParty = newCp;
                        await session.UpdateAsync(t);
                        movedHdfcTxs.Add(t);
                    }
                }

                // Restore UPI IDs that appear in the restored transactions
                foreach (var upi in primary.UpiIds.ToList())
                {
                    bool matchesMovedTxs = movedIobTxs.Any(t => t.Description != null && t.Description.Contains(upi.UpiId, StringComparison.OrdinalIgnoreCase)) ||
                                           movedHdfcTxs.Any(t => (t.Description != null && t.Description.Contains(upi.UpiId, StringComparison.OrdinalIgnoreCase)) ||
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
            catch (Exception ex)
            {
                Log.Exception(ex);
                return StatusCode(500, "Internal server error");
            }
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