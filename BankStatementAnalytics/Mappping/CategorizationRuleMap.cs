using NHibernate.Mapping.ByCode;
using NHibernate.Mapping.ByCode.Conformist;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Mappping
{
    public class CategorizationRuleMap : ClassMapping<CategorizationRule>
    {
        public CategorizationRuleMap()
        {
            Table("CategorizationRules");

            Id(x => x.Id, m =>
            {
                m.Generator(Generators.Identity);
            });

            Property(x => x.OwnerUserId, m => m.Index("IX_CategorizationRules_OwnerUserId"));

            Property(x => x.Name, m =>
            {
                m.Length(250);
                m.NotNullable(true);
            });

            Property(x => x.Priority);
            Property(x => x.Enabled);

            Property(x => x.NarrationContains, m => m.Length(500));
            Property(x => x.NarrationRegex, m => m.Length(500));
            Property(x => x.MinAmount);
            Property(x => x.MaxAmount);
            Property(x => x.ModeEquals, m => m.Length(50));
            Property(x => x.BankEquals, m => m.Length(50));

            Property(x => x.SetCategory, m => m.Length(250));
            Property(x => x.SetSubCategory, m => m.Length(250));
            Property(x => x.SetTags, m => m.Length(500));
            Property(x => x.SetNote, m => m.Length(1000));

            Property(x => x.CreatedOn);
            Property(x => x.UpdatedOn);
        }
    }
}
