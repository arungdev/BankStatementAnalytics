using Common.Framework.Tenancy;

namespace BankStatementAnalytics.Models
{
    /// <summary>
    /// A monthly recurring bill (rent, utility, subscription, EMI) that a user has confirmed
    /// or dismissed. Detected candidates are matched back to transactions via <see cref="MatchKey"/>.
    /// Dismissed rows exist only to suppress re-suggestion of the same key.
    /// </summary>
    public class RecurringBill : IOwnedEntity
    {
        public virtual int Id { get; set; }

        // The user who owns this bill; null only for rows created before multi-user support existed.
        public virtual long? OwnerUserId { get; set; }

        // Display name, e.g. "Netflix".
        public virtual string Name { get; set; } = string.Empty;

        // Normalized merchant name / narration used to link the bill back to transactions.
        public virtual string MatchKey { get; set; } = string.Empty;

        // Set when the candidate came from a known merchant; null for narration-only matches.
        public virtual Merchant? CounterParty { get; set; }

        public virtual decimal ExpectedAmount { get; set; }

        // Typical day of month (1-31) the debit posts.
        public virtual int DueDayOfMonth { get; set; }

        // "Confirmed" or "Dismissed".
        public virtual string Status { get; set; } = "Confirmed";

        public virtual DateTime? LastSeenDate { get; set; }

        public virtual DateTime CreatedOn { get; set; } = DateTime.Now;
        public virtual DateTime UpdatedOn { get; set; } = DateTime.Now;
    }
}
