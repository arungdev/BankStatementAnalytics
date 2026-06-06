// Data/TransactionRepositoryFactory.cs
namespace BankStatementAnalytics.Data
{
    public class TransactionRepositoryFactory
    {
        public ITransactionRepository GetRepository(string bank) => bank switch
        {
            "IOB" => new IobTransactionRepository(),
            "HDFC" => new HdfcTransactionRepository(),
            _ => throw new NotSupportedException($"No repository for bank: {bank}")
        };
    }
}