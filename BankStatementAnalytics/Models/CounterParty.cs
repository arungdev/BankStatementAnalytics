// Models/CounterParty.cs
namespace BankStatementAnalytics.Models
{
    public class CounterParty
    {
        public virtual int Id { get; set; }
        public virtual string Name { get; set; } = string.Empty;
        public virtual string? FriendlyName { get; set; }
        public virtual string? Category { get; set; }
        public virtual string? SubCategory { get; set; }
        public virtual string? BankCode { get; set; }
        public virtual string? Notes { get; set; }
        public virtual DateTime CreatedOn { get; set; }
        public virtual DateTime? UpdatedOn { get; set; }

        // One person can have many UPI IDs
        public virtual IList<CounterPartyUpi> UpiIds { get; set; }
            = new List<CounterPartyUpi>();
    }
}