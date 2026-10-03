using NHibernate.Mapping.ByCode;
using NHibernate.Mapping.ByCode.Conformist;
using BankStatementAnalytics.Models;
using Common.Framework.Types;

namespace BankStatementAnalytics.Mappping
{
    public class SplitGroupMap : ClassMapping<SplitGroup>
    {
        public SplitGroupMap()
        {
            Table("Split_Groups");

            Id(x => x.Id, m =>
            {
                m.Generator(Generators.Identity);
            });

            Property(x => x.OwnerUserId, m => m.Index("IX_SplitGroups_OwnerUserId"));

            Property(x => x.GroupUid, m =>
            {
                m.Type<GuidToStringType>();
                m.Length(50);
                m.Index("IX_SplitGroups_GroupUid");
            });

            Property(x => x.Title, m =>
            {
                m.Length(250);
                m.NotNullable(true);
            });

            Property(x => x.SourceKey, m => m.Length(64));
            Property(x => x.SourceState, m => m.Length(50));
            Property(x => x.CreatorName, m => m.Length(250));
            Property(x => x.SourceSnapshot, m => m.Type(NHibernate.NHibernateUtil.StringClob));
            Property(x => x.SourceImportedUtc);

            Property(x => x.Description, m => m.Length(1000));
            Property(x => x.Date, m => m.Index("IX_SplitGroups_Date"));

            Property(x => x.TotalAmount);
            Property(x => x.UserShareAmount);
            Property(x => x.SettledAmount);

            Property(x => x.Status, m => m.Length(50));
            Property(x => x.Confidence, m => m.Length(50));
            Property(x => x.SplitType, m => m.Length(50));
            Property(x => x.BillGroupId, m => m.Index("IX_SplitGroups_BillGroupId"));
            Property(x => x.GroupName, m => m.Length(250));

            Property(x => x.ParentAccountId);
            Property(x => x.ParentBankReference, m => m.Length(100));
            Property(x => x.ParentBankType, m => m.Length(50));
            Property(x => x.ParentTransactionType, m => m.Length(10));

            Property(x => x.CreatedOn);
            Property(x => x.UpdatedOn);

            Bag(x => x.Members, m =>
            {
                m.Key(k => k.Column("SplitGroupId"));
                m.Cascade(Cascade.All | Cascade.DeleteOrphans);
                m.Inverse(true);
            }, r => r.OneToMany());
        }
    }
}
