using Common.Framework.Tenancy;
namespace BankStatementAnalytics.Models;

/// <summary>Tenant-owned immutable imported record, batch inventory or explicit review decision.</summary>
public class GPayEvidenceRecord : IOwnedEntity
{
    public virtual int Id { get; set; }
    public virtual long? OwnerUserId { get; set; }
    public virtual string Kind { get; set; } = "";
    public virtual string SourceKey { get; set; } = "";
    public virtual string Payload { get; set; } = "";
    public virtual DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
}

public class GPaySettlementAllocation : IOwnedEntity
{
    public virtual int Id { get; set; }
    public virtual long? OwnerUserId { get; set; }
    public virtual int SplitId { get; set; }
    public virtual int MemberId { get; set; }
    public virtual long AccountId { get; set; }
    public virtual string BankReference { get; set; } = "";
    public virtual string BankType { get; set; } = "";
    public virtual string TransactionType { get; set; } = "";
    public virtual decimal Amount { get; set; }
    public virtual DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
}
