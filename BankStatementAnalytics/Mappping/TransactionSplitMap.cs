using NHibernate.Mapping.ByCode;
using NHibernate.Mapping.ByCode.Conformist;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Mappping
{
    public class TransactionSplitMap : ClassMapping<TransactionSplit>
    {
        public TransactionSplitMap()
        {
            Table("TransactionSplits");

            Id(x => x.Id, m =>
            {
                m.Generator(Generators.Identity);
            });

            Property(x => x.OwnerUserId, m => m.Index("IX_TransactionSplits_OwnerUserId"));

            Property(x => x.ParentAccountId, m => m.Index("IX_TransactionSplits_Parent"));
            Property(x => x.ParentBankReference, m =>
            {
                m.Length(100);
                m.NotNullable(true);
                m.Index("IX_TransactionSplits_Parent");
            });
            Property(x => x.ParentBankType, m =>
            {
                m.Length(50);
                m.NotNullable(true);
            });

            Property(x => x.Amount);

            Property(x => x.Category, m => m.Length(250));
            Property(x => x.SubCategory, m => m.Length(250));
            Property(x => x.Note, m => m.Length(1000));

            Property(x => x.CreatedOn);
        }
    }
}
