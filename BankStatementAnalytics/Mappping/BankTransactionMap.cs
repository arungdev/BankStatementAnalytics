using BankStatementAnalytics.Models;
using Common.Framework.Types;
using NHibernate.Mapping.ByCode;
using NHibernate.Mapping.ByCode.Conformist;

namespace BankStatementAnalytics.Mappping
{
    public class BankTransactionMap : ClassMapping<BankTransaction>
    {
        public BankTransactionMap()
        {
            Table("Bank_Transactions");

            ComposedId(m =>
            {
                m.Property(x => x.AccountId);
                m.Property(x => x.BankReference);
                m.Property(x => x.BankType, p => p.Length(10));
            });

            Property(x => x.TransactionDate);
            Property(x => x.ValueDate);

            Property(x => x.TransactionType, m => m.Length(10));

            Property(x => x.Description, m => m.Length(2000));

            Property(x => x.Amount);
            Property(x => x.Debit);
            Property(x => x.Credit);
            Property(x => x.Balance);

            Property(x => x.ImportedOn);
            Property(x => x.UploadId, m =>
            {
                m.Type<GuidToStringType>();
                m.Length(50);
            });
            Property(x => x.UpiReference, m => m.Length(50));
            Property(x => x.BankCode, m => m.Length(20));
            Property(x => x.Mode, m => m.Length(50));

            Property(x => x.Narration, m => m.Length(2000));
            Property(x => x.ChequeNumber, m => m.Length(50));
            Property(x => x.CustomerReference, m => m.Length(100));
            Property(x => x.UpiVpa, m => m.Length(255));
            Property(x => x.CategoryOverride);
            Property(x => x.SubCategoryOverride);
            Property(x => x.Tags);

            ManyToOne(x => x.CounterParty, m =>
            {
                m.Column("CounterPartyId");
                m.NotNullable(false);
                m.Fetch(FetchKind.Join);
            });
        }
    }
}