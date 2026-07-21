
using BankStatementAnalytics.EnumClass;
using Common.Framework.Tenancy;

namespace BankStatementAnalytics.Models
{
    public class Account : IOwnedEntity
    {
        public virtual long Id { get; set; }

        // The user who owns this account; null only for rows created before multi-user support existed.
        public virtual long? OwnerUserId { get; set; }

        // Stored account number (will be masked before persistence)
        public virtual string AccountNumber { get; set; } = string.Empty;

        public virtual string AccountHolderName { get; set; } = string.Empty;

        public virtual Bank BankName { get; set; } 

        public virtual string BranchCode { get; set; } = string.Empty;

        // Credit-card-only metadata. Auto-filled from a parsed statement summary
        // when a CC PDF is uploaded; editable manually in Settings as a fallback.
        public virtual decimal? CreditLimit { get; set; }

        // Day of month the card's statement is generated (1-31), used to derive
        // billing-cycle boundaries when no parsed statement summary exists.
        public virtual int? StatementDay { get; set; }

        // Credit cards issued against another card's limit (HDFC add-on/second
        // cards) point at that primary card here; utilization is then computed on
        // the combined outstanding of the group against the shared limit.
        public virtual long? SharedLimitAccountId { get; set; }

        // Folder watched by the auto-import background service; null/empty = not configured.
        public virtual string? WatchFolderPath { get; set; }

        // Pause switch for the watcher. Nullable so SchemaUpdate can add the column;
        // null == enabled (rows configured before the flag existed keep importing).
        public virtual bool? WatchEnabled { get; set; }

        // Password for protected statement PDFs picked up from the watch folder.
        // Stored plaintext in the local DB — never echoed back through the API.
        public virtual string? StatementPassword { get; set; }

        // Computed property that exposes a masked version of the account number
        public virtual string MaskedAccountNumber
        {
            get
            {
                if (string.IsNullOrEmpty(AccountNumber))
                    return string.Empty;

                var digits = AccountNumber.Trim();
                int len = digits.Length;
                if (len <= 4) return new string('X', len);
                return new string('X', len - 4) + digits.Substring(len - 4);
            }
        }

        // Helper to mask a number (used before saving to storage)
        public static string Mask(string? number)
        {
            if (string.IsNullOrEmpty(number)) return string.Empty;
            var digits = number.Trim();
            int len = digits.Length;
            if (len <= 4) return new string('X', len);
            return new string('X', len - 4) + digits.Substring(len - 4);
        }
    }
}
