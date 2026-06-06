namespace BankStatementAnalytics.Models
{
    public class SubCategory
    {
        public virtual int Id { get; set; }
        public virtual string Name { get; set; } = string.Empty;
        public virtual Category Category { get; set; }
    }
}