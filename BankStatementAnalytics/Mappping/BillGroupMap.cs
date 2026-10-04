using NHibernate.Mapping.ByCode;
using NHibernate.Mapping.ByCode.Conformist;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Mappping
{
    public class BillGroupMap : ClassMapping<BillGroup>
    {
        public BillGroupMap()
        {
            Table("Bill_Groups");

            Id(x => x.Id, m =>
            {
                m.Generator(Generators.Identity);
            });

            Property(x => x.OwnerUserId, m => m.Index("IX_BillGroups_OwnerUserId"));
            Property(x => x.Name, m =>
            {
                m.Length(250);
                m.NotNullable(true);
            });
            Property(x => x.Description, m => m.Length(1000));
            Property(x => x.GPayProfileId, m => m.Length(64));
            Property(x => x.CreatedOn);
            Property(x => x.UpdatedOn);

            Bag(x => x.Members, m =>
            {
                m.Key(k => k.Column("BillGroupId"));
                m.Cascade(Cascade.All | Cascade.DeleteOrphans);
                m.Inverse(true);
            }, r => r.OneToMany());

            Bag(x => x.Splits, m =>
            {
                m.Key(k => k.Column("BillGroupId"));
                m.Cascade(Cascade.None);
                m.Inverse(true);
            }, r => r.OneToMany());
        }
    }
}
