// Data/HdfcTransactionRepository.cs
using NHibernate;
using BankStatementAnalytics.Dtos;
using BankStatementAnalytics.Models;
using Common.Framework.Data;

namespace BankStatementAnalytics.Data
{
    public class HdfcTransactionRepository : ITransactionRepository
    {
        public List<TransactionDto> GetByAccount(int accountId)
        {
            using var session = DbHelper.GetSession();

            return session.CreateQuery(@"
                select t from BankTransaction t
                left join fetch t.CounterParty
                where t.AccountId = :id
                order by t.TransactionDate desc")
                .SetParameter("id", accountId)
                .List<BankTransaction>()
                .Select(x => new TransactionDto
                {
                    TransactionDate = x.TransactionDate,
                    UpiReference = x.UpiReference,
                    CounterParty = x.CounterParty?.Name,
                    Category = x.CounterParty?.Category,
                    Mode = x.Mode,
                    Debit = x.Debit,
                    Credit = x.Credit,
                    Balance = x.Balance,
                })
                .ToList();
        }
    }
}