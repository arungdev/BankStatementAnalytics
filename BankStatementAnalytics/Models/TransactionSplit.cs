using System;
using Common.Framework.Tenancy;

namespace BankStatementAnalytics.Models
{
    /// <summary>
    /// Represents a sub-division of a single bank transaction into multiple categories.
    /// E.g. a ₹3,000 supermarket bill split into ₹2,000 Groceries and ₹1,000 Electronics.
    /// </summary>
    public class TransactionSplit : IOwnedEntity
    {
        public virtual int Id { get; set; }

        public virtual long? OwnerUserId { get; set; }

        public virtual long ParentAccountId { get; set; }

        public virtual string ParentBankReference { get; set; } = string.Empty;

        public virtual string ParentBankType { get; set; } = string.Empty;

        public virtual decimal Amount { get; set; }

        public virtual string? Category { get; set; }

        public virtual string? SubCategory { get; set; }

        public virtual string? Note { get; set; }

        public virtual DateTime CreatedOn { get; set; } = DateTime.Now;
    }
}
