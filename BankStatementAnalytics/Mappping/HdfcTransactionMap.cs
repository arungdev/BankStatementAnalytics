using NHibernate.Mapping.ByCode;
using NHibernate.Mapping.ByCode.Conformist;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Mappping
{
    public class HdfcTransactionMap : ClassMapping<HdfcTransaction>
    {
        public HdfcTransactionMap()
        {
            Table("HDFC_Transactions");

            // ── Composite PK: AccountId + BankReference ──────────────
            ComposedId(m =>
            {
                m.Property(x => x.AccountId);
                m.Property(x => x.BankReference);
            });

            // ── Base fields (shared with IobTransaction) ─────────────
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

            // ── HDFC specific fields ─────────────────────────────────
            Property(x => x.Narration, m =>
            {
                m.Length(2000);
            });

            Property(x => x.ChequeNumber, m =>
            {
                m.Length(50);
            });

            Property(x => x.CustomerReference, m =>
            {
                m.Length(100);
            });

            // ── Shared UPI / bank fields ─────────────────────────────
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

            // ── FK to CounterParties ─────────────────────────────────
            ManyToOne(x => x.CounterParty, m =>
            {
                m.Column("CounterPartyId");
                m.NotNullable(false);
                m.Fetch(FetchKind.Join);
            });
        }
    }
}