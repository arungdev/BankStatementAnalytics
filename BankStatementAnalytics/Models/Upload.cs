using System;
namespace BankStatementAnalytics.Models
{
    public class Upload
    {
        public virtual Guid Id { get; set; }

        public virtual string FileName { get; set; }

        public virtual string StoredName { get; set; }

        public virtual int? AccountId { get; set; }

        public virtual string Path { get; set; }

        public virtual DateTime UploadedAt { get; set; } = DateTime.UtcNow;

        public virtual Guid? TransactionId { get; set; }

        // SHA-256 (hex) of the file's contents, used to reject re-uploading the same file.
        public virtual string? FileHash { get; set; }

        // Transactions parsed from the file vs. those that were actually new (not already imported).
        public virtual int TotalCount { get; set; }
        public virtual int NewCount { get; set; }
    }
}
