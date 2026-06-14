using BankStatementAnalytics.EnumClass;

namespace BankStatementAnalytics.Data
{
    public class TransactionRepositoryFactory
    {
        public ITransactionRepository GetRepository(Bank bank) => bank switch
        {
            Bank.IOB => new IobTransactionRepository(),
            Bank.HDFC => new HdfcTransactionRepository(),
            _ => throw new NotSupportedException($"No repository for bank: {bank}")
        };
    }
}