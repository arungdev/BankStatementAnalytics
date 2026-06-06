using System.Collections.Generic;

namespace BankStatementAnalytics.Models
{
    public class Category
    {
        public virtual int Id { get; set; }
        public virtual string Name { get; set; } = string.Empty;
        
        // One Category can have many SubCategories
        public virtual IList<SubCategory> SubCategories { get; set; } = new List<SubCategory>();
    }
}