using BankStatementAnalytics.Services.Parser;

public class ParserFactory
{
    public static IBankParser GetParser(string bank)
    {
        return bank switch
        {
            "IOB" => new OpTransactionParser(new()),
            "HDFC" => new HdfcParser(),
            _ => throw new Exception("Unsupported Bank")
        };
    }
}