using NHibernate.Mapping.ByCode;
using NHibernate.Mapping.ByCode.Conformist;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Mappping
{
    public class SavingsGoalMap : ClassMapping<SavingsGoal>
    {
        public SavingsGoalMap()
        {
            Table("SavingsGoals");

            Id(x => x.Id, m =>
            {
                m.Generator(Generators.Identity);
            });

            Property(x => x.OwnerUserId, m => m.Index("IX_SavingsGoals_OwnerUserId"));

            Property(x => x.Name, m =>
            {
                m.Length(250);
                m.NotNullable(true);
            });

            Property(x => x.TargetAmount);
            Property(x => x.CurrentSaved);
            Property(x => x.TargetDate);
            Property(x => x.Category, m => m.Length(100));
            Property(x => x.Notes, m => m.Length(1000));
            Property(x => x.Status, m => m.Length(50));
            Property(x => x.CreatedOn);
            Property(x => x.UpdatedOn);
        }
    }
}
