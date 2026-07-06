using Common.Framework.Tenancy;

namespace BankStatementAnalytics.Models
{
    public class Tag : IOwnedEntity
    {
        public virtual long Id { get; set; }
        public virtual long? OwnerUserId { get; set; }
        public virtual string Name { get; set; } = string.Empty;
    }
}
