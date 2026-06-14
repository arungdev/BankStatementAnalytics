using BankStatementAnalytics.Models;
using Common.Framework.Types;
using NHibernate.Mapping.ByCode;
using NHibernate.Mapping.ByCode.Conformist;

namespace BankStatementAnalytics.Mappping
{
    public class UploadTransactionMap : ClassMapping<UploadTransaction>
    {
        public UploadTransactionMap()
        {
            Table("UploadTransactions");

            Id(x => x.Id, m => m.Type<GuidToStringType>());

            Property(x => x.UploadId, m =>
            {
                m.Type<GuidToStringType>();
                m.Length(50);
            });
            Property(x => x.Amount);
            Property(x => x.Description, m => m.Length(1000));
            Property(x => x.CreatedAt);
        }
    }
}
