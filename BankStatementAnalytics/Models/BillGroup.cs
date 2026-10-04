using System;
using System.Collections.Generic;
using Common.Framework.Tenancy;

namespace BankStatementAnalytics.Models
{
    /// <summary>
    /// Represents a persistent GPay-style group (e.g. "Flatmates", "Goa Trip", "Office Lunch")
    /// that can contain multiple bill splits / expenses over time.
    /// </summary>
    public class BillGroup : IOwnedEntity
    {
        public virtual int Id { get; set; }

        public virtual long? OwnerUserId { get; set; }

        public virtual string Name { get; set; } = string.Empty;
        public virtual string? GPayProfileId { get; set; }

        public virtual string? Description { get; set; }

        public virtual DateTime CreatedOn { get; set; } = DateTime.Now;

        public virtual DateTime? UpdatedOn { get; set; }

        /// <summary>Persistent members of this group (friends, flatmates, etc.).</summary>
        public virtual IList<BillGroupMember> Members { get; set; } = new List<BillGroupMember>();

        /// <summary>All bill splits / expenses created inside this group.</summary>
        public virtual IList<SplitGroup> Splits { get; set; } = new List<SplitGroup>();
    }
}
