// Mapping/CounterPartyUpiMap.cs
using NHibernate.Mapping.ByCode;
using NHibernate.Mapping.ByCode.Conformist;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Mapping
{
    public class MerchantUpiMap : ClassMapping<MerchantUpi>
    {
        public MerchantUpiMap()
        {
            Table("MerchantUpis");

            Id(x => x.Id, m => m.Generator(Generators.Identity));

            ManyToOne(x => x.CounterParty, m =>
            {
                m.Column("CounterPartyId");
                m.NotNullable(true);
                m.Fetch(FetchKind.Select);
            });

            Property(x => x.UpiId, m =>
            {
                m.Column("UpiId");
                m.Length(100);
                m.NotNullable(true);
            });

            Property(x => x.CreatedOn);
        }
    }
}