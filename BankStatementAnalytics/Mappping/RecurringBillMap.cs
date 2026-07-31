using NHibernate.Mapping.ByCode;
using NHibernate.Mapping.ByCode.Conformist;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Mappping
{
    public class RecurringBillMap : ClassMapping<RecurringBill>
    {
        public RecurringBillMap()
        {
            Table("RecurringBills");

            Id(x => x.Id, m =>
            {
                m.Generator(Generators.Identity);
            });

            Property(x => x.OwnerUserId, m => m.Index("IX_RecurringBills_OwnerUserId"));

            Property(x => x.Name, m =>
            {
                m.Length(250);
                m.NotNullable(true);
            });

            Property(x => x.MatchKey, m =>
            {
                m.Length(500);
                m.NotNullable(true);
            });

            Property(x => x.ExpectedAmount);
            Property(x => x.DueDayOfMonth);
            Property(x => x.Cadence, m => m.Length(20));
            Property(x => x.Status, m => m.Length(20));
            Property(x => x.LastSeenDate);
            Property(x => x.CreatedOn);
            Property(x => x.UpdatedOn);

            ManyToOne(x => x.CounterParty, m =>
            {
                m.Column("CounterPartyId");
                m.NotNullable(false);
                m.Index("IX_RecurringBills_CounterPartyId");
            });
        }
    }
}
