using NHibernate.Mapping.ByCode;
using NHibernate.Mapping.ByCode.Conformist;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Mappping
{
    public class SplitGroupMemberMap : ClassMapping<SplitGroupMember>
    {
        public SplitGroupMemberMap()
        {
            Table("Split_Group_Members");

            Id(x => x.Id, m =>
            {
                m.Generator(Generators.Identity);
            });

            Property(x => x.OwnerUserId, m => m.Index("IX_SplitGroupMembers_OwnerUserId"));

            ManyToOne(x => x.Group, m =>
            {
                m.Column("SplitGroupId");
                m.NotNullable(true);
                m.Index("IX_SplitGroupMembers_SplitGroupId");
            });

            Property(x => x.ParticipantName, m =>
            {
                m.Length(250);
                m.NotNullable(true);
            });

            Property(x => x.ParticipantVpa, m => m.Length(255));
            Property(x => x.AssignedAmount);
            Property(x => x.PaidAmount);
            Property(x => x.IsSettled);
            Property(x => x.IsUser);

            Property(x => x.LinkedAccountId);
            Property(x => x.LinkedBankReference, m => m.Length(100));
            Property(x => x.LinkedBankType, m => m.Length(50));
            Property(x => x.LinkedTransactionType, m => m.Length(10));

            Property(x => x.Notes, m => m.Length(1000));
            Property(x => x.CreatedOn);
        }
    }
}
