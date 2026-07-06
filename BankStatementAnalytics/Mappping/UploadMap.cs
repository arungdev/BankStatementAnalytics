using BankStatementAnalytics.Models;
using Common.Framework.Types;
using NHibernate.Mapping.ByCode;
using NHibernate.Mapping.ByCode.Conformist;

namespace BankStatementAnalytics.Mappping
{
    public class UploadMap : ClassMapping<Upload>
    {
        public UploadMap()
        {
            Table("Uploads");

            Id(x => x.Id, m => m.Type<GuidToStringType>());

            Property(x => x.FileName, m => m.Length(500));
            Property(x => x.StoredName, m => m.Length(500));
            Property(x => x.AccountId);
            Property(x => x.Path, m => m.Length(1000));
            Property(x => x.UploadedAt);
            Property(x => x.TransactionId, m =>
            {
                m.Type<GuidToStringType>();
                m.Length(50);
            });
            Property(x => x.FileHash, m => { m.Length(64); m.Index("IX_Uploads_FileHash"); });
            Property(x => x.TotalCount);
            Property(x => x.NewCount);
        }
    }
}
