namespace BankStatementAnalytics.Dtos
{
    public class TransactionDto
    {
        public DateTime TransactionDate { get; set; }
        public string Description { get; set; }
        public string UpiReference { get; set; }
        public string CounterParty { get; set; }
        public string Mode { get; set; }
        public decimal? Debit { get; set; }
        public decimal? Credit { get; set; }
        public decimal? Balance { get; set; }
        public virtual string? Category { get; set; }
    }
}