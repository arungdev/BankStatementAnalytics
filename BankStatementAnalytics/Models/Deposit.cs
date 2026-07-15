using Common.Framework.Tenancy;

namespace BankStatementAnalytics.Models
{
    /// <summary>
    /// User-entered metadata for a detected deposit (RD or FD). The live figures — installments,
    /// amount invested, dates — are always derived on the fly from transactions; this row only
    /// stores what can't be inferred (nickname, interest rate, maturity date, planned tenure).
    /// Joined to detection results by <see cref="Kind"/> + <see cref="MatchKey"/>.
    /// </summary>
    public class Deposit : IOwnedEntity
    {
        public virtual int Id { get; set; }

        public virtual long? OwnerUserId { get; set; }

        // "RD" or "FD".
        public virtual string Kind { get; set; } = "RD";

        // Stable detection key — the deposit account number extracted from the narration.
        public virtual string MatchKey { get; set; } = string.Empty;

        // Optional display-name override; detection supplies a default when this is null.
        public virtual string? Nickname { get; set; }

        // Annual interest rate (%), user-entered.
        public virtual decimal? InterestRate { get; set; }

        // Maturity date, user-entered (or derived from tenure when left blank).
        public virtual DateTime? MaturityDate { get; set; }

        // Planned tenure in months — drives RD progress (installments paid / tenure).
        public virtual int? TermMonths { get; set; }

        public virtual string? Note { get; set; }

        public virtual DateTime CreatedOn { get; set; } = DateTime.Now;
        public virtual DateTime UpdatedOn { get; set; } = DateTime.Now;
    }
}
