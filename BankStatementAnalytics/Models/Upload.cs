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
    }
}
