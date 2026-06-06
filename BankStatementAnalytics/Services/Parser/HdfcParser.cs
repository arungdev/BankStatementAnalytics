using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Services.Parser
{
    public class HdfcParser : IBankParser
    {
        public IEnumerable<BaseTransaction> Parse(string text, int acoountid)
        {
            throw new NotImplementedException();
        }
    }
}
