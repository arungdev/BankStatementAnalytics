using BankStatementAnalytics.Models;
using NHibernate.Mapping.ByCode;
using NHibernate.Mapping.ByCode.Conformist;

namespace BankStatementAnalytics.Mappping
{
    public class TagMap : ClassMapping<Tag>
    {
        public TagMap()
        {
            Table("Tags");
            Id(x => x.Id, m => m.Generator(Generators.Native));
            Property(x => x.OwnerUserId, m => m.Index("IX_Tags_OwnerUserId"));
            Property(x => x.Name, m => m.Length(100));
        }
    }
}
