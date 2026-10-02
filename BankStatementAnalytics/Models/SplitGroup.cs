using System;
using System.Collections.Generic;
using Common.Framework.Tenancy;

namespace BankStatementAnalytics.Models
{
    /// <summary>
    /// Represents a multi-party bill split or group payment (e.g. GPay Split, shared dinner, trip expenses).
    /// Links a primary bill expense to participant shares and tracking incoming/settled repayments.
    /// </summary>
    public class SplitGroup : IOwnedEntity
    {
        public virtual int Id { get; set; }

        public virtual long? OwnerUserId { get; set; }

        /// <summary>Unique identifier for the group, shared across members and linked records.</summary>
        public virtual Guid GroupUid { get; set; } = Guid.NewGuid();

        /// <summary>Title or purpose of the split (e.g. "Dinner with Rahul & Priya", "Flat Electricity Bill").</summary>
        public virtual string Title { get; set; } = string.Empty;

        public virtual string? Description { get; set; }

        /// <summary>Date the expense or split occurred.</summary>
        public virtual DateTime Date { get; set; } = DateTime.Today;

        /// <summary>Total bill amount (e.g. ₹1,200.00).</summary>
        public virtual decimal TotalAmount { get; set; }

        /// <summary>User's own personal share of the bill (e.g. ₹300.00).</summary>
        public virtual decimal UserShareAmount { get; set; }

        /// <summary>Sum of repayments collected from participants so far.</summary>
        public virtual decimal SettledAmount { get; set; }

        /// <summary>"Active", "Settled", or "Archived".</summary>
        public virtual string Status { get; set; } = "Active";

        /// <summary>"Confirmed", "Medium", "Low", or "Manual".</summary>
        public virtual string Confidence { get; set; } = "Confirmed";

        /// <summary>"GPaySplit", "GroupPayment", or "ManualSplit".</summary>
        public virtual string SplitType { get; set; } = "GPaySplit";

        // ── Optional link to the parent expense / bill transaction ──
        public virtual long? ParentAccountId { get; set; }
        public virtual string? ParentBankReference { get; set; }
        public virtual string? ParentBankType { get; set; }
        public virtual string? ParentTransactionType { get; set; }

        public virtual DateTime CreatedOn { get; set; } = DateTime.Now;
        public virtual DateTime? UpdatedOn { get; set; }

        /// <summary>The individual participants and their assigned split amounts.</summary>
        public virtual IList<SplitGroupMember> Members { get; set; } = new List<SplitGroupMember>();
    }
}
