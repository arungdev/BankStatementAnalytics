using System;

namespace BankStatementAnalytics.Models
{
    public class UploadTransaction
    {
        public virtual Guid Id { get; set; }

        public virtual Guid UploadId { get; set; }

        public virtual decimal? Amount { get; set; }

        public virtual string Description { get; set; }

        public virtual DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }
}
