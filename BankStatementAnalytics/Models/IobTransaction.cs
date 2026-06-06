namespace BankStatementAnalytics.Models
{
    public class IobTransaction : BaseTransaction
    {
        public virtual string UpiReference { get; set; } = string.Empty;

        public virtual string BankCode { get; set; } = string.Empty;

        public virtual string Mode { get; set; } = string.Empty;
        // ── CounterParty as FK instead of plain string ───────────────────────
        public virtual Merchant? CounterParty { get; set; }

        public override bool Equals(object obj)
        {
            if (obj is not IobTransaction other)
                return false;

            return AccountId == other.AccountId &&
                   BankReference == other.BankReference;
        }

        public override int GetHashCode()
        {
            return HashCode.Combine(AccountId, BankReference);
        }

    }
}