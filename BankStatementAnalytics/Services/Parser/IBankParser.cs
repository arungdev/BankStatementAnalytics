using BankStatementAnalytics.Models;

public interface IBankParser
{
    IEnumerable<BaseTransaction> Parse(string text,int accountId);
}