using System.Text.Json.Serialization;

namespace BankStatementAnalytics.Models
{
    public class BankTransaction
    {

        public virtual long AccountId { get; set; }

        public virtual DateTime TransactionDate { get; set; }

        public virtual DateTime? ValueDate { get; set; }

        // Month-attribution date; null means "use TransactionDate". Set to the first of
        // the next month when the merchant is flagged ShiftToNextMonth and the transaction
        // falls on/after EffectiveDateCalculator.MonthEndDayThreshold.
        public virtual DateTime? EffectiveDate { get; set; }

        public virtual string BankReference { get; set; } = string.Empty;

        public virtual string TransactionType { get; set; } = string.Empty;

        public virtual string Description { get; set; } = string.Empty;

        public virtual decimal Amount { get; set; }

        public virtual decimal Debit { get; set; }

        public virtual decimal Credit { get; set; }

        public virtual decimal Balance { get; set; }

        public virtual DateTime ImportedOn { get; set; } = DateTime.Now;

        public virtual Guid? UploadId { get; set; }
        public virtual string BankType { get; set; } = string.Empty; // "HDFC" or "IOB"

        public virtual string UpiReference { get; set; } = string.Empty;
        public virtual string BankCode { get; set; } = string.Empty;
        public virtual string Mode { get; set; } = string.Empty;
        public virtual Merchant? CounterParty { get; set; }

        public virtual string Narration { get; set; } = string.Empty;
        public virtual string ChequeNumber { get; set; } = string.Empty;
        public virtual string CustomerReference { get; set; } = string.Empty;
        public virtual string? UpiVpa { get; set; }
        public virtual string? CategoryOverride { get; set; }
        public virtual string? SubCategoryOverride { get; set; }
        public virtual string? Tags { get; set; } // comma-separated e.g. "food,rent,bills"
        public virtual string? Note { get; set; } // user-entered free-text annotation

        // Transient (not mapped, not serialized): the counterparty name a parser extracted from the
        // narration, resolved to a Merchant in a single batch after parsing rather than per-row.
        [JsonIgnore]
        public virtual string? PendingCounterPartyName { get; set; }

        public override bool Equals(object? obj)
        {
            if (obj is not BankTransaction other) return false;
            return AccountId == other.AccountId &&
                   BankReference == other.BankReference &&
                   BankType == other.BankType;
        }

        public override int GetHashCode()
            => HashCode.Combine(AccountId, BankReference, BankType);
    }
}