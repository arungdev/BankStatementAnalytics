using NHibernate.Mapping.ByCode;
using NHibernate.Mapping.ByCode.Conformist;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Mappping
{
    public class BankStatementMap : ClassMapping<BankStatement>
    {
        public BankStatementMap()
        {
            Table("Statements");

            Id(x => x.Id, m =>
            {
                m.Generator(Generators.Identity);
            });

            Property(x => x.StatementFrom);
            Property(x => x.StatementTo);
            Property(x => x.ImportedOn);

            ManyToOne(x => x.Account, m =>
            {
                m.Column("AccountId");
            });

        }
    }
}