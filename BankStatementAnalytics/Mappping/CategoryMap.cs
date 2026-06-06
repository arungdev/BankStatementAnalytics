using NHibernate.Mapping.ByCode;
using NHibernate.Mapping.ByCode.Conformist;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Mappping
{
    public class CategoryMap : ClassMapping<Category>
    {
        public CategoryMap()
        {
            Table("Categories");

            Id(x => x.Id, m => m.Generator(Generators.Identity));

            Property(x => x.Name, m => { m.Length(250); m.NotNullable(true); });

            // One-to-many: Category → SubCategories
            Bag(x => x.SubCategories, m =>
            {
                m.Key(k => k.Column("CategoryId"));
                m.Cascade(Cascade.All | Cascade.DeleteOrphans);
                m.Inverse(true); // SubCategory is responsible for saving the foreign key
                m.Lazy(CollectionLazy.NoLazy);
            },
            r => r.OneToMany());
        }
    }
}