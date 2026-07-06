
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
