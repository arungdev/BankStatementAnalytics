namespace BankStatementAnalytics.Models
{
    public abstract class BaseTransaction
    {
        public virtual long AccountId { get; set; }

        public virtual DateTime TransactionDate { get; set; }

        public virtual DateTime? ValueDate { get; set; }

        public virtual string BankReference { get; set; } = string.Empty;

        public virtual string TransactionType { get; set; } = string.Empty;

        public virtual string Description { get; set; } = string.Empty;

        public virtual decimal Amount { get; set; }

        public virtual decimal Debit { get; set; }

        public virtual decimal Credit { get; set; }

        public virtual decimal Balance { get; set; }

        public virtual DateTime ImportedOn { get; set; } = DateTime.Now;

        public virtual Guid? UploadId { get; set; }
    }
}