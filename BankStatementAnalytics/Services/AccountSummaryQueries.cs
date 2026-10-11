using BankStatementAnalytics.Models;
using NHibernate;
using NHibernate.Linq;
using ISession = NHibernate.ISession;

namespace BankStatementAnalytics.Services;

/// <summary>Bounded queries for all account cards, rather than queries per card.</summary>
public static class AccountSummaryQueries
{
    public sealed class LatestTransaction
    {
        public long AccountId { get; set; }
        public DateTime TransactionDate { get; set; }
        public string? Description { get; set; }
        public string? Merchant { get; set; }
        public decimal Debit { get; set; }
        public decimal Credit { get; set; }
        public decimal Balance { get; set; }
    }

    public static Dictionary<long, LatestTransaction> Latest(ISession session, IReadOnlyCollection<long> accountIds)
    {
        var result = new Dictionary<long, LatestTransaction>();
        foreach (var ids in accountIds.Chunk(400))
        {
            var rows = session.CreateSQLQuery(@"
                SELECT accountid, transactiondate, description, merchant, debit, credit, balance FROM (
                  SELECT t.accountid, t.transactiondate, t.description, m.name AS merchant,
                    t.debit, t.credit, t.balance,
                    ROW_NUMBER() OVER (PARTITION BY t.accountid ORDER BY
                      t.transactiondate DESC, t.importedon DESC, t.bankreference DESC, t.transactiontype DESC) AS ordinal
                  FROM bank_transactions t LEFT JOIN merchant m ON m.id = t.counterpartyid
                  WHERE t.accountid IN (:ids)
                ) ranked WHERE ordinal = 1")
                .AddScalar("accountid", NHibernateUtil.Int64)
                .AddScalar("transactiondate", NHibernateUtil.DateTime)
                .AddScalar("description", NHibernateUtil.String)
                .AddScalar("merchant", NHibernateUtil.String)
                .AddScalar("debit", NHibernateUtil.Decimal)
                .AddScalar("credit", NHibernateUtil.Decimal)
                .AddScalar("balance", NHibernateUtil.Decimal)
                .SetParameterList("ids", ids).List<object[]>();
            foreach (var row in rows)
            {
                var item = new LatestTransaction { AccountId = (long)row[0], TransactionDate = (DateTime)row[1],
                    Description = row[2] as string, Merchant = row[3] as string,
                    Debit = (decimal)row[4], Credit = (decimal)row[5], Balance = (decimal)row[6] };
                result[item.AccountId] = item;
            }
        }
        return result;
    }

    public static Dictionary<long, decimal?> CardBalances(ISession session, IReadOnlyCollection<long> ids,
        IReadOnlyDictionary<long, CardStatementSummary> summaries)
    {
        var result = new Dictionary<long, decimal?>();
        foreach (var batch in ids.Chunk(400))
        {
            var accountBatch = batch.ToList();
            // One row per activity date, grouped in SQL. No full transaction
            // histories are materialized just to display outstanding balances.
            var activity = session.Query<BankTransaction>().Where(t => accountBatch.Contains(t.AccountId))
                .GroupBy(t => new { t.AccountId, t.TransactionDate })
                .Select(g => new { g.Key.AccountId, g.Key.TransactionDate, Net = g.Sum(t => t.Debit - t.Credit) }).ToList();
            foreach (var id in batch)
            {
                summaries.TryGetValue(id, out var summary);
                var anchored = summary?.StatementDate != null && summary.TotalDue != null;
                var rows = activity.Where(t => t.AccountId == id && (!anchored || t.TransactionDate > summary!.StatementDate!.Value));
                result[id] = !anchored && !activity.Any(t => t.AccountId == id) ? null :
                    Math.Max(0m, (anchored ? summary!.TotalDue!.Value : 0m) + rows.Sum(t => t.Net));
            }
        }
        return result;
    }
}
