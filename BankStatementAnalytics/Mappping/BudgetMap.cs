using NHibernate.Mapping.ByCode;
using NHibernate.Mapping.ByCode.Conformist;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Mappping
{
    public class BudgetMap : ClassMapping<Budget>
    {
        public BudgetMap()
        {
            Table("Budgets");

            Id(x => x.Id, m =>
            {
                m.Generator(Generators.Identity);
            });

            Property(x => x.OwnerUserId, m => m.Index("IX_Budgets_OwnerUserId"));

            Property(x => x.Category, m =>
            {
                m.Length(250);
                m.NotNullable(true);
            });

            Property(x => x.MonthlyLimit);
            Property(x => x.CreatedOn);
            Property(x => x.UpdatedOn);
        }
    }
}
