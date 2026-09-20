using System;
using Common.Framework.Tenancy;

namespace BankStatementAnalytics.Models
{
    /// <summary>
    /// A user-defined financial savings target (e.g., "Emergency Fund", "New Laptop", "Vacation").
    /// Tracks target amount, target completion date, and current accumulated savings.
    /// </summary>
    public class SavingsGoal : IOwnedEntity
    {
        public virtual int Id { get; set; }

        public virtual long? OwnerUserId { get; set; }

        public virtual string Name { get; set; } = string.Empty;

        public virtual decimal TargetAmount { get; set; }

        public virtual decimal CurrentSaved { get; set; }

        public virtual DateTime? TargetDate { get; set; }

        public virtual string? Category { get; set; }

        public virtual string? Notes { get; set; }

        public virtual string Status { get; set; } = "Active"; // "Active", "Completed", "Paused"

        public virtual DateTime CreatedOn { get; set; } = DateTime.Now;

        public virtual DateTime UpdatedOn { get; set; } = DateTime.Now;
    }
}
