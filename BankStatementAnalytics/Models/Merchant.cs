// Models/CounterParty.cs
using Common.Framework.Tenancy;

namespace BankStatementAnalytics.Models
{
    public class Merchant : IOwnedEntity
    {
        public virtual int Id { get; set; }
        public virtual long? OwnerUserId { get; set; }
        public virtual string Name { get; set; } = string.Empty;
        public virtual string? FriendlyName { get; set; }
        public virtual string? Category { get; set; }
        public virtual string? SubCategory { get; set; }
        public virtual string? BankCode { get; set; }
        public virtual string? Notes { get; set; }
        public virtual DateTime CreatedOn { get; set; }
        public virtual DateTime? UpdatedOn { get; set; }

        // One person can have many UPI IDs
        public virtual IList<MerchantUpi> UpiIds { get; set; }
            = new List<MerchantUpi>();

        // Names that were merged into this counterparty
        public virtual IList<string> Aliases { get; set; } = new List<string>();
    }
}