using NHibernate.Mapping.ByCode;
using NHibernate.Mapping.ByCode.Conformist;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Mappping
{
    public class CardStatementSummaryMap : ClassMapping<CardStatementSummary>
    {
        public CardStatementSummaryMap()
        {
            Table("CardStatementSummaries");

            Id(x => x.Id, m =>
            {
                m.Generator(Generators.Identity);
            });

            Property(x => x.AccountId, m => m.Index("IX_CardStatementSummaries_AccountId"));
            Property(x => x.UploadId);
            Property(x => x.StatementDate);
            Property(x => x.PeriodStart);
            Property(x => x.PeriodEnd);
            Property(x => x.PaymentDueDate);
            Property(x => x.TotalDue);
            Property(x => x.MinimumDue);
            Property(x => x.CreditLimit);
            Property(x => x.AvailableCreditLimit);
            Property(x => x.RewardPointsBalance);
            Property(x => x.CreatedAt);
        }
    }
}
