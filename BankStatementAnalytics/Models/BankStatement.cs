
namespace BankStatementAnalytics.Models
{
    public class BankStatement
    {
        public virtual long Id { get; set; }

        public virtual Account Account { get; set; }

        public virtual DateTime StatementFrom { get; set; }

        public virtual DateTime StatementTo { get; set; }

        public virtual DateTime ImportedOn { get; set; }

    }
}
