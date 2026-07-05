// Mapping/CounterPartyMap.cs
using NHibernate.Mapping.ByCode;
using NHibernate.Mapping.ByCode.Conformist;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Mapping
{
    public class MerchantMap : ClassMapping<Merchant>
    {
        public MerchantMap()
        {
            Table("Merchant");

            Id(x => x.Id, m => m.Generator(Generators.Identity));

            Property(x => x.OwnerUserId, m => m.Index("IX_Merchant_OwnerUserId"));

            Property(x => x.Name, m => { m.Length(250); m.NotNullable(true); m.Index("IX_Merchant_Name_BankCode"); });
            Property(x => x.FriendlyName, m => m.Length(250));
            Property(x => x.Category, m => m.Length(100));
            Property(x => x.SubCategory, m => m.Length(100));
            Property(x => x.BankCode, m => { m.Length(20); m.Index("IX_Merchant_Name_BankCode"); });
            Property(x => x.Notes, m => m.Length(500));
            Property(x => x.CreatedOn);
            Property(x => x.UpdatedOn);

            // One-to-many: CounterParty → UPI IDs
            Bag(x => x.UpiIds, m =>
            {
                m.Key(k => k.Column("CounterPartyId"));
                m.Cascade(Cascade.All | Cascade.DeleteOrphans);
                m.Inverse(true);
                m.Lazy(CollectionLazy.NoLazy);  // always load with parent
            },
            r => r.OneToMany());

            // Aliases collection to track merged names
            Bag(x => x.Aliases, m =>
            {
                m.Table("CounterPartyAliases");
                m.Key(k => k.Column("CounterPartyId"));
                m.Lazy(CollectionLazy.Lazy);
            }, r => r.Element(e => e.Column(c =>
            {
                c.Name("AliasName");
                c.Index("IX_CounterPartyAliases_AliasName");
            })));
        }
    }
}