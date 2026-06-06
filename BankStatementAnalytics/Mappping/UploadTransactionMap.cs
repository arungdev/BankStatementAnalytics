using NHibernate.Mapping.ByCode;
using NHibernate.Mapping.ByCode.Conformist;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Mappping
{
    public class UploadTransactionMap : ClassMapping<UploadTransaction>
    {
        public UploadTransactionMap()
        {
            Table("UploadTransactions");

            Id(x => x.Id, m => m.Generator(Generators.GuidComb));

            Property(x => x.UploadId);
            Property(x => x.Amount);
            Property(x => x.Description, m => m.Length(1000));
            Property(x => x.CreatedAt);
        }
    }
}
