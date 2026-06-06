// Models/CounterPartyUpi.cs
namespace BankStatementAnalytics.Models
{
    public class CounterPartyUpi
    {
        public virtual int Id { get; set; }
        public virtual CounterParty CounterParty { get; set; } = null!;
        public virtual string UpiId { get; set; } = string.Empty;  // "9443528960@HDFC"
        public virtual DateTime CreatedOn { get; set; }
    }
}