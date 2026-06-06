using NHibernate.Mapping.ByCode;
using NHibernate.Mapping.ByCode.Conformist;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Mappping
{
    public class IobTransactionMap : ClassMapping<IobTransaction>
    {
        public IobTransactionMap()
        {
            Table("IOB_Transactions");

            ComposedId(m =>
            {
                m.Property(x => x.AccountId);
                m.Property(x => x.BankReference);
            });
            Property(x => x.TransactionDate);

            Property(x => x.ValueDate);

            Property(x => x.TransactionType, m =>
            {
                m.Length(10);
            });

            Property(x => x.Description, m =>
            {
                m.Length(2000);
            });

            Property(x => x.Amount);

            Property(x => x.Debit);

            Property(x => x.Credit);

            Property(x => x.Balance);

            Property(x => x.ImportedOn);
            Property(x => x.UploadId);

            // IOB Specific Fields

            Property(x => x.UpiReference, m =>
            {
                m.Length(50);
            });

            Property(x => x.BankCode, m =>
            {
                m.Length(20);
            });

            Property(x => x.Mode, m =>
            {
                m.Length(50);
            });
            // ── FK to CounterParties ─────────────────────────────────────────
            ManyToOne(x => x.CounterParty, m =>
            {
                m.Column("CounterPartyId");
                m.NotNullable(false);
                m.Fetch(FetchKind.Join);
            });
        }
    }

}