namespace BankStatementAnalytics.EnumClass
{
    /// <summary>
    /// The short code stored in BankTransaction.BankType. The column is
    /// varchar(10) in every existing install and NHibernate schema update never
    /// widens columns, so codes must stay ≤ 10 chars. The code is part of the
    /// dedupe identity (AccountId + BankReference + BankType) — changing a
    /// bank's code orphans its previously imported rows.
    /// </summary>
    public static class BankTypeCode
    {
        public static string For(Bank bank) => bank switch
        {
            Bank.HDFCCreditCard => "HDFCCC", // enum name is 14 chars — doesn't fit
            _ => bank.ToString(),
        };
    }
}
