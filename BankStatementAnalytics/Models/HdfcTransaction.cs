// HdfcTransaction.cs
namespace BankStatementAnalytics.Models
{
    public class HdfcTransaction : BaseTransaction
    {
        public virtual string Narration { get; set; } = string.Empty;
        public virtual string ChequeNumber { get; set; } = string.Empty;
        public virtual string CustomerReference { get; set; } = string.Empty;

        // ── Shared with IobTransaction ───────────────────────────────
        public virtual string UpiReference { get; set; } = string.Empty;
        public virtual string BankCode { get; set; } = string.Empty;
        public virtual string Mode { get; set; } = string.Empty;
        public virtual CounterParty? CounterParty { get; set; }
        // Models/HdfcTransaction.cs — add one field
        public virtual string? UpiVpa { get; set; }  

        public override bool Equals(object? obj)
        {
            if (obj is not HdfcTransaction other) return false;
            return AccountId == other.AccountId &&
                   BankReference == other.BankReference;
        }

        public override int GetHashCode()
            => HashCode.Combine(AccountId, BankReference);
    }
}