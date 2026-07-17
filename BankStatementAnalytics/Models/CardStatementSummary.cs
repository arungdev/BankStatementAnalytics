using System;

namespace BankStatementAnalytics.Models
{
    /// <summary>
    /// The statement-level summary block of a credit card e-statement (total due,
    /// minimum due, due date, limits, reward points). One row per billed statement;
    /// re-uploading the same statement replaces the row for (AccountId, StatementDate).
    /// All figures are nullable — extraction is best-effort and a missing field must
    /// never block the transaction import.
    /// </summary>
    public class CardStatementSummary
    {
        public virtual long Id { get; set; }

        public virtual long AccountId { get; set; }

        // The upload this summary was parsed from; deleting the upload removes the summary.
        public virtual Guid? UploadId { get; set; }

        public virtual DateTime? StatementDate { get; set; }
        public virtual DateTime? PeriodStart { get; set; }
        public virtual DateTime? PeriodEnd { get; set; }
        public virtual DateTime? PaymentDueDate { get; set; }

        public virtual decimal? TotalDue { get; set; }
        public virtual decimal? MinimumDue { get; set; }
        public virtual decimal? CreditLimit { get; set; }
        public virtual decimal? AvailableCreditLimit { get; set; }

        public virtual int? RewardPointsBalance { get; set; }

        public virtual DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public virtual bool HasAnyValue =>
            StatementDate != null || PaymentDueDate != null || TotalDue != null ||
            MinimumDue != null || CreditLimit != null || AvailableCreditLimit != null ||
            RewardPointsBalance != null;
    }
}
