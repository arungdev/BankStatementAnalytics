using BankStatementAnalytics.Models;

public interface IBankParser
{
    IEnumerable<BankTransaction> Parse(string text,int accountId);
}