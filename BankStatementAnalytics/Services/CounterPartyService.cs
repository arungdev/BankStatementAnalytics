// Services/CounterPartyService.cs
using Common.Framework.Data;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Services
{
    public class CounterPartyService
    {

        public Merchant ResolveOrCreate(
            string name,
            string? bankCode,
            long accountId,
            string? upiId = null)
        {
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            // Merchants are private per user - scope every lookup (and any newly created
            // Merchant) to whichever user owns this transaction's account.
            var ownerUserId = session.Get<Account>(accountId)?.OwnerUserId;

            Merchant? found = null;

            // ── 1. Try match by UPI ID ───────────────────────────────────────
            if (!string.IsNullOrWhiteSpace(upiId))
            {
                found = session.Query<MerchantUpi>()
                    .Where(u => u.UpiId == upiId && u.CounterParty.OwnerUserId == ownerUserId)
                    .Select(u => u.CounterParty)
                    .FirstOrDefault();
            }

            if (found == null)
            {
                // Check if the name matches either the primary Name, or any of the previously merged Aliases
                found = session.Query<Merchant>()
                    .FirstOrDefault(x => x.OwnerUserId == ownerUserId &&
                        ((x.Name == name && x.BankCode == bankCode) || x.Aliases.Contains(name)));
            }

            // ── 3. Create new ────────────────────────────────────────────────
            if (found == null)
            {
                found = new Merchant
                {
                    Name = name,
                    BankCode = bankCode,
                    OwnerUserId = ownerUserId,
                    CreatedOn = DateTime.Now,
                };
                session.Save(found);
            }

            // ── Track which account this merchant was funded from ────────────
            if (!found.AccountIds.Contains(accountId))
            {
                found.AccountIds.Add(accountId);
            }

            // ── Add UPI ID if new ────────────────────────────────────────────
            if (!string.IsNullOrWhiteSpace(upiId))
            {
                bool upiExists = found.UpiIds.Any(u => u.UpiId == upiId);
                if (!upiExists)
                {
                    var newUpi = new MerchantUpi
                    {
                        CounterParty = found,
                        UpiId = upiId,
                        CreatedOn = DateTime.Now,
                    };
                    found.UpiIds.Add(newUpi);
                    session.Save(newUpi);
                }
            }

            tx.Commit();
            return found;
        }
    }
}
