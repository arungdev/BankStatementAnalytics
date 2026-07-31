using System;

namespace BankStatementAnalytics.Models
{
    // One row per watch-folder import attempt — success or failure — so the UI
    // can show auto-import history even though a failed import leaves no Upload row.
    public class ImportHistory
    {
        public virtual Guid Id { get; set; }

        public virtual int AccountId { get; set; }

        public virtual string FileName { get; set; } = string.Empty;

        // Full path of the file in the watch folder it was picked up from.
        public virtual string? SourcePath { get; set; }

        // "Success" | "Failed"
        public virtual string Status { get; set; } = string.Empty;

        public virtual string? Error { get; set; }

        public virtual DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Set on success; the Upload row may later be reverted independently.
        public virtual Guid? UploadId { get; set; }
    }
}
