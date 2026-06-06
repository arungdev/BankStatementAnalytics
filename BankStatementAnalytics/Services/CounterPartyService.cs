// Services/CounterPartyService.cs
using BankStatementAnalytics.Data;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Services
{
    public class CounterPartyService
    {

        public CounterParty ResolveOrCreate(
            string name,
            string? bankCode,
            string? upiId = null)
        {
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            CounterParty? found = null;

            // ── 1. Try match by UPI ID ───────────────────────────────────────
            if (!string.IsNullOrWhiteSpace(upiId))
            {
                found = session.Query<CounterPartyUpi>()
                    .Where(u => u.UpiId == upiId)
                    .Select(u => u.CounterParty)
                    .FirstOrDefault();
            }

            if (found == null)
            {
                found = session.Query<CounterParty>()
                    .FirstOrDefault(x => x.Name == name && x.BankCode == bankCode);
            }

            // ── 3. Create new ────────────────────────────────────────────────
            if (found == null)
            {
                found = new CounterParty
                {
                    Name = name,
                    BankCode = bankCode,
                    CreatedOn = DateTime.Now,
                };
                session.Save(found);
            }

            // ── Add UPI ID if new ────────────────────────────────────────────
            if (!string.IsNullOrWhiteSpace(upiId))
            {
                bool upiExists = found.UpiIds.Any(u => u.UpiId == upiId);
                if (!upiExists)
                {
                    var newUpi = new CounterPartyUpi
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