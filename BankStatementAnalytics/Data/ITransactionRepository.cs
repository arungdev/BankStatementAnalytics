// Data/ITransactionRepository.cs
using BankStatementAnalytics.Dtos;

namespace BankStatementAnalytics.Data
{
    public interface ITransactionRepository
    {
        List<TransactionDto> GetByAccount(int accountId);
    }
}