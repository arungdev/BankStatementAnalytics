using Common.Framework.Tenancy;

namespace BankStatementAnalytics.Models
{
    /// <summary>
    /// A monthly spending limit for a single category. Budgets are per-user and span all of the
    /// user's accounts; actual spend is computed on the fly from that month's debits, resolving each
    /// transaction's category the same way Insights does (override → merchant default → "Uncategorized").
    /// </summary>
    public class Budget : IOwnedEntity
    {
        public virtual int Id { get; set; }

        // The user who owns this budget; null only for rows created before multi-user support existed.
        public virtual long? OwnerUserId { get; set; }

        // The category name this budget caps. Matches the resolved category used across Insights.
        public virtual string Category { get; set; } = string.Empty;

        // Monthly cap in account currency.
        public virtual decimal MonthlyLimit { get; set; }

        public virtual DateTime CreatedOn { get; set; } = DateTime.Now;
        public virtual DateTime UpdatedOn { get; set; } = DateTime.Now;
    }
}
