using BankStatementAnalytics.Models;
using NHibernate.Linq;
using ISession = NHibernate.ISession;

namespace BankStatementAnalytics.Services
{
    /// <summary>
    /// Single source of truth for the month-attribution ("effective") date of a
    /// transaction. Merchants flagged <see cref="Merchant.ShiftToNextMonth"/> have
    /// their month-end transactions counted toward the following month in all
    /// month-based analytics (e.g. salary credited June 30 counts as July income).
    /// </summary>
    public static class EffectiveDateCalculator
    {
        // Transactions on/after this day of the month shift to the next month when
        // the merchant is flagged. Earlier days (e.g. salary landing on the 1st-2nd)
        // stay in their actual month so they are never double-shifted.
        public const int MonthEndDayThreshold = 25;

        /// <summary>
        /// Returns the effective-date override for a transaction, or null when the
        /// transaction should count in its actual month.
        /// </summary>
        public static DateTime? Compute(DateTime transactionDate, bool shiftToNextMonth)
            => shiftToNextMonth && transactionDate.Day >= MonthEndDayThreshold
                ? new DateTime(transactionDate.Year, transactionDate.Month, 1).AddMonths(1)
                : null;

        /// <summary>
        /// Recomputes EffectiveDate for every transaction of a merchant, e.g. after
        /// the flag is toggled or transactions are reassigned by a merge.
        /// </summary>
        public static async Task RecomputeForMerchantAsync(ISession session, int merchantId, bool shiftToNextMonth)
        {
            if (!shiftToNextMonth)
            {
                await session.CreateQuery(
                        "update BankTransaction set EffectiveDate = null where CounterParty.Id = :id")
                    .SetParameter("id", merchantId)
                    .ExecuteUpdateAsync();
                return;
            }

            var transactions = await session.Query<BankTransaction>()
                .Where(t => t.CounterParty != null && t.CounterParty.Id == merchantId)
                .ToListAsync();

            foreach (var t in transactions)
                t.EffectiveDate = Compute(t.TransactionDate, true);
        }
    }
}
