using NHibernate.Mapping.ByCode;
using NHibernate.Mapping.ByCode.Conformist;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Mappping
{
    public class BillGroupMemberMap : ClassMapping<BillGroupMember>
    {
        public BillGroupMemberMap()
        {
            Table("Bill_Group_Members");

            Id(x => x.Id, m =>
            {
                m.Generator(Generators.Identity);
            });

            Property(x => x.OwnerUserId, m => m.Index("IX_BillGroupMembers_OwnerUserId"));

            ManyToOne(x => x.Group, m =>
            {
                m.Column("BillGroupId");
                m.NotNullable(true);
                m.Index("IX_BillGroupMembers_GroupId");
            });

            Property(x => x.Name, m =>
            {
                m.Length(250);
                m.NotNullable(true);
            });

            Property(x => x.Vpa, m => m.Length(255));
            Property(x => x.CreatedOn);
        }
    }
}
