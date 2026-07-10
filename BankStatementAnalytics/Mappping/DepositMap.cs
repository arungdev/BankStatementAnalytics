using NHibernate.Mapping.ByCode;
using NHibernate.Mapping.ByCode.Conformist;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Mappping
{
    public class DepositMap : ClassMapping<Deposit>
    {
        public DepositMap()
        {
            Table("Deposits");

            Id(x => x.Id, m =>
            {
                m.Generator(Generators.Identity);
            });

            Property(x => x.OwnerUserId, m => m.Index("IX_Deposits_OwnerUserId"));

            Property(x => x.Kind, m =>
            {
                m.Length(4);
                m.NotNullable(true);
            });

            Property(x => x.MatchKey, m =>
            {
                m.Length(500);
                m.NotNullable(true);
            });

            Property(x => x.Nickname, m => m.Length(250));
            Property(x => x.InterestRate);
            Property(x => x.MaturityDate);
            Property(x => x.TermMonths);
            Property(x => x.Note, m => m.Length(1000));
            Property(x => x.CreatedOn);
            Property(x => x.UpdatedOn);
        }
    }
}
