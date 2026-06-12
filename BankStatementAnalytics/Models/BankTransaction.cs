namespace BankStatementAnalytics.Models
{
    public class BankTransaction : BaseTransaction
    {
        public virtual string BankType { get; set; } = string.Empty; // "HDFC" or "IOB"

        public virtual string UpiReference { get; set; } = string.Empty;
        public virtual string BankCode { get; set; } = string.Empty;
        public virtual string Mode { get; set; } = string.Empty;
        public virtual Merchant? CounterParty { get; set; }

        public virtual string Narration { get; set; } = string.Empty;
        public virtual string ChequeNumber { get; set; } = string.Empty;
        public virtual string CustomerReference { get; set; } = string.Empty;
        public virtual string? UpiVpa { get; set; }

        public override bool Equals(object? obj)
        {
            if (obj is not BankTransaction other) return false;
            return AccountId == other.AccountId &&
                   BankReference == other.BankReference &&
                   BankType == other.BankType;
        }

        public override int GetHashCode()
            => HashCode.Combine(AccountId, BankReference, BankType);
    }
}