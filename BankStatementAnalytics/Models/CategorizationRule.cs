using System;
using Common.Framework.Tenancy;

namespace BankStatementAnalytics.Models
{
    /// <summary>
    /// User-defined categorization and annotation rule applied automatically to incoming transactions
    /// and retroactively on demand. Evaluated in ascending priority order.
    /// </summary>
    public class CategorizationRule : IOwnedEntity
    {
        public virtual int Id { get; set; }

        public virtual long? OwnerUserId { get; set; }

        public virtual string Name { get; set; } = string.Empty;

        public virtual int Priority { get; set; } = 0;

        public virtual bool Enabled { get; set; } = true;

        // Matching conditions (null/empty = any)
        public virtual string? NarrationContains { get; set; }

        public virtual string? NarrationRegex { get; set; }

        public virtual decimal? MinAmount { get; set; }

        public virtual decimal? MaxAmount { get; set; }

        public virtual string? ModeEquals { get; set; }

        public virtual string? BankEquals { get; set; }

        // Actions to apply
        public virtual string? SetCategory { get; set; }

        public virtual string? SetSubCategory { get; set; }

        public virtual string? SetTags { get; set; }

        public virtual string? SetNote { get; set; }

        public virtual DateTime CreatedOn { get; set; } = DateTime.Now;

        public virtual DateTime UpdatedOn { get; set; } = DateTime.Now;
    }
}
