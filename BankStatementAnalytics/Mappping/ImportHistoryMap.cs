using BankStatementAnalytics.Models;
using Common.Framework.Types;
using NHibernate.Mapping.ByCode;
using NHibernate.Mapping.ByCode.Conformist;

namespace BankStatementAnalytics.Mappping
{
    public class ImportHistoryMap : ClassMapping<ImportHistory>
    {
        public ImportHistoryMap()
        {
            Table("ImportHistory");

            Id(x => x.Id, m => m.Type<GuidToStringType>());

            Property(x => x.AccountId, m => m.Index("IX_ImportHistory_AccountId"));
            Property(x => x.FileName, m => m.Length(500));
            Property(x => x.SourcePath, m => m.Length(1000));
            Property(x => x.Status, m => m.Length(20));
            Property(x => x.Error, m => m.Length(2000));
            Property(x => x.CreatedAt);
            Property(x => x.UploadId, m =>
            {
                m.Type<GuidToStringType>();
                m.Length(50);
            });
        }
    }
}
