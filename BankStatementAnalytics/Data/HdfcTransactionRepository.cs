// Data/HdfcTransactionRepository.cs
using NHibernate;
using BankStatementAnalytics.Dtos;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Data
{
    public class HdfcTransactionRepository : ITransactionRepository
    {
        public List<TransactionDto> GetByAccount(int accountId)
        {
            using var session = DbHelper.GetSession();

            return session.CreateQuery(@"
                select t from HdfcTransaction t
                left join fetch t.CounterParty
                where t.AccountId = :id
                order by t.TransactionDate desc")
                .SetParameter("id", accountId)
                .List<HdfcTransaction>()
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