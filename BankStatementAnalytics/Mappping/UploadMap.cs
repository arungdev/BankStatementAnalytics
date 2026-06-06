using NHibernate.Mapping.ByCode;
using NHibernate.Mapping.ByCode.Conformist;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Mappping
{
    public class UploadMap : ClassMapping<Upload>
    {
        public UploadMap()
        {
            Table("Uploads");

            Id(x => x.Id, m => m.Generator(Generators.GuidComb));

            Property(x => x.FileName, m => m.Length(500));
            Property(x => x.StoredName, m => m.Length(500));
            Property(x => x.AccountId);
            Property(x => x.Path, m => m.Length(1000));
            Property(x => x.UploadedAt);
            Property(x => x.TransactionId);
        }
    }
}
