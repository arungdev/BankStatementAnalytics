using System;
using Common.Framework.Tenancy;

namespace BankStatementAnalytics.Models
{
    /// <summary>
    /// Represents one participant's assigned split amount and settlement state within a <see cref="SplitGroup"/>.
    /// </summary>
    public class SplitGroupMember : IOwnedEntity
    {
        public virtual int Id { get; set; }

        public virtual long? OwnerUserId { get; set; }

        public virtual SplitGroup Group { get; set; } = null!;

        /// <summary>Name of the participant (e.g. "Rahul Sharma", "Self").</summary>
        public virtual string ParticipantName { get; set; } = string.Empty;

        /// <summary>UPI Virtual Payment Address of the participant (e.g. "rahul@okaxis").</summary>
        public virtual string? ParticipantVpa { get; set; }

        /// <summary>The split amount assigned to this participant (e.g. ₹300.00).</summary>
        public virtual decimal AssignedAmount { get; set; }

        /// <summary>Amount received or paid by this participant so far.</summary>
        public virtual decimal PaidAmount { get; set; }

        /// <summary>True if this participant has fully settled their share.</summary>
        public virtual bool IsSettled { get; set; }

        /// <summary>True if this member represents the account owner themselves.</summary>
        public virtual bool IsUser { get; set; }

        // ── Link to the bank transaction that settled this member's share ──
        public virtual long? LinkedAccountId { get; set; }
        public virtual string? LinkedBankReference { get; set; }
        public virtual string? LinkedBankType { get; set; }
        public virtual string? LinkedTransactionType { get; set; }

        public virtual string? SourceState { get; set; }
        public virtual string? SettlementEvidence { get; set; }

        public virtual string? Notes { get; set; }

        public virtual DateTime CreatedOn { get; set; } = DateTime.Now;
    }
}
