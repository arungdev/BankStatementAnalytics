// Models/CounterPartyUpi.cs
namespace BankStatementAnalytics.Models
{
    public class MerchantUpi
    {
        public virtual int Id { get; set; }
        public virtual Merchant CounterParty { get; set; } = null!;
        public virtual string UpiId { get; set; } = string.Empty;  // "9443528960@HDFC"
        public virtual DateTime CreatedOn { get; set; }
    }
}