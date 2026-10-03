using NHibernate.Mapping.ByCode;
using NHibernate.Mapping.ByCode.Conformist;
using BankStatementAnalytics.Models;
namespace BankStatementAnalytics.Mappping;
public class GPayEvidenceRecordMap : ClassMapping<GPayEvidenceRecord>
{
    public GPayEvidenceRecordMap() {
        Table("gpay_evidence_records"); Id(x => x.Id, m => m.Generator(Generators.Identity));
        Property(x => x.OwnerUserId); Property(x => x.Kind, m => m.Length(40));
        Property(x => x.SourceKey, m => m.Length(64));
        Property(x => x.Payload, m => m.Type(NHibernate.NHibernateUtil.StringClob)); Property(x => x.CreatedUtc);
    }
}
public class GPaySettlementAllocationMap : ClassMapping<GPaySettlementAllocation>
{
    public GPaySettlementAllocationMap() {
        Table("gpay_settlement_allocations"); Id(x => x.Id, m => m.Generator(Generators.Identity));
        Property(x => x.OwnerUserId); Property(x => x.SplitId); Property(x => x.MemberId);
        Property(x => x.AccountId); Property(x => x.BankReference, m => m.Length(100));
        Property(x => x.BankType, m => m.Length(50)); Property(x => x.TransactionType, m => m.Length(10));
        Property(x => x.Amount); Property(x => x.CreatedUtc);
    }
}
