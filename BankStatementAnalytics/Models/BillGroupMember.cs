using System;
using Common.Framework.Tenancy;

namespace BankStatementAnalytics.Models
{
    /// <summary>
    /// Represents a member within a persistent <see cref="BillGroup"/>.
    /// </summary>
    public class BillGroupMember : IOwnedEntity
    {
        public virtual int Id { get; set; }

        public virtual long? OwnerUserId { get; set; }

        public virtual BillGroup Group { get; set; } = null!;

        public virtual string Name { get; set; } = string.Empty;

        public virtual string? Vpa { get; set; }

        public virtual DateTime CreatedOn { get; set; } = DateTime.Now;
    }
}
