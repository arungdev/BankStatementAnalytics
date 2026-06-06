using NHibernate.Mapping.ByCode;
using NHibernate.Mapping.ByCode.Conformist;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Mappping
{
    public class SubCategoryMap : ClassMapping<SubCategory>
    {
        public SubCategoryMap()
        {
            Table("SubCategories");

            Id(x => x.Id, m => m.Generator(Generators.Identity));

            Property(x => x.Name, m => { m.Length(250); m.NotNullable(true); });

            ManyToOne(x => x.Category, m =>
            {
                m.Column("CategoryId");
                m.NotNullable(true);
            });
        }
    }
}