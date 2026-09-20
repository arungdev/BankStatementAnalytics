using System;
using System.Collections.Generic;
using System.Linq;
using NHibernate.Linq;
using Common.Framework.Data;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Services
{
    public class DuplicateDetectionService
    {
        public List<DuplicateAlert> DetectDuplicates(long userId, int lookbackDays = 90)
        {
            using var session = DbHelper.GetSession();

            var accountIds = AccountAccess.OwnedIds(session, userId);
            if (accountIds.Count == 0)
                return new List<DuplicateAlert>();

            var since = DateTime.Today.AddDays(-lookbackDays);

            var debits = session.Query<BankTransaction>()
                .ExcludeOwnMoneyMoves()
                .Where(t => accountIds.Contains(t.AccountId) && t.Debit > 0 && t.TransactionDate >= since)
                .Select(t => new
                {
                    t.AccountId,
                    t.BankReference,
                    t.BankType,
                    t.TransactionDate,
                    t.Description,
                    t.Debit,
                    t.Mode,
                    MerchantName = t.CounterParty != null ? t.CounterParty.Name : null,
                })
                .ToList();

            var accounts = session.Query<Account>()
                .Where(a => accountIds.Contains(a.Id))
                .ToList()
                .ToDictionary(a => a.Id, a => $"{a.BankName} ({a.MaskedAccountNumber})");

            var results = new List<DuplicateAlert>();

            // Group by Amount + Normalized Merchant / Key
            var grouped = debits
                .GroupBy(t => new
                {
                    Amount = t.Debit,
                    Key = NormalizeMerchant(t.MerchantName ?? t.Description)
                })
                .Where(g => g.Count() > 1);

            foreach (var group in grouped)
            {
                if (string.IsNullOrWhiteSpace(group.Key.Key)) continue;

                var items = group.OrderBy(x => x.TransactionDate).ToList();
                for (int i = 0; i < items.Count - 1; i++)
                {
                    var a = items[i];
                    var b = items[i + 1];

                    var gapDays = (b.TransactionDate.Date - a.TransactionDate.Date).TotalDays;
                    if (gapDays >= 0 && gapDays <= 2)
                    {
                        var id = $"{a.BankReference}_{b.BankReference}";
                        results.Add(new DuplicateAlert
                        {
                            Id = id,
                            Merchant = a.MerchantName ?? a.Description ?? group.Key.Key,
                            Amount = a.Debit,
                            Date1 = a.TransactionDate,
                            Date2 = b.TransactionDate,
                            AccountId1 = a.AccountId,
                            Account1 = accounts.TryGetValue(a.AccountId, out var acc1) ? acc1 : a.AccountId.ToString(),
                            AccountId2 = b.AccountId,
                            Account2 = accounts.TryGetValue(b.AccountId, out var acc2) ? acc2 : b.AccountId.ToString(),
                            BankRef1 = a.BankReference,
                            BankRef2 = b.BankReference,
                            SameAccount = a.AccountId == b.AccountId,
                            DaysApart = (int)gapDays
                        });
                    }
                }
            }

            return results.OrderByDescending(r => r.Date2).ToList();
        }

        private static string NormalizeMerchant(string input)
        {
            if (string.IsNullOrWhiteSpace(input)) return string.Empty;
            var clean = input.Trim().ToUpperInvariant();
            if (clean.StartsWith("UPI/"))
            {
                var parts = clean.Split('/');
                if (parts.Length > 2 && !string.IsNullOrWhiteSpace(parts[2]))
                    return parts[2].Trim();
            }
            return clean;
        }
    }

    public class DuplicateAlert
    {
        public string Id { get; set; } = string.Empty;
        public string Merchant { get; set; } = string.Empty;
        public decimal Amount { get; set; }
        public DateTime Date1 { get; set; }
        public DateTime Date2 { get; set; }
        public long AccountId1 { get; set; }
        public string Account1 { get; set; } = string.Empty;
        public long AccountId2 { get; set; }
        public string Account2 { get; set; } = string.Empty;
        public string BankRef1 { get; set; } = string.Empty;
        public string BankRef2 { get; set; } = string.Empty;
        public bool SameAccount { get; set; }
        public int DaysApart { get; set; }
    }
}
