using NHibernate.Mapping.ByCode;
using NHibernate.Mapping.ByCode.Conformist;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Mappping
{
    public class AccountMap : ClassMapping<Account>
    {
        public AccountMap()
        {
            Table("Accounts");

            Id(x => x.Id, m =>
            {
                m.Generator(Generators.Identity);
            });

            Property(x => x.OwnerUserId, m => m.Index("IX_Accounts_OwnerUserId"));

            Property(x => x.AccountNumber, m =>
            {
                m.Length(50);
                m.NotNullable(true);
            });

            Property(x => x.AccountHolderName);
            Property(x => x.BankName);
            Property(x => x.BranchCode);
        }
    }
}