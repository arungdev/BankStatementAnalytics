// Dtos/CounterPartyDto.cs
namespace BankStatementAnalytics.Dtos
{
    public class CounterPartyDto
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public string? FriendlyName { get; set; }
        public string? Category { get; set; }
        public string? SubCategory { get; set; }
        public string? BankCode { get; set; }
        public string? Notes { get; set; }
        public List<string> UpiIds { get; set; } = new();  // ["9443528960@HDFC"]
        public List<TransactionDto> Transactions { get; set; } = new();
    }
}