using System.Collections.Generic;
using Common.Framework.Tenancy;

namespace BankStatementAnalytics.Models
{
    public class Category : IOwnedEntity
    {
        public virtual int Id { get; set; }
        public virtual long? OwnerUserId { get; set; }
        public virtual string Name { get; set; } = string.Empty;

        // One Category can have many SubCategories
        public virtual IList<SubCategory> SubCategories { get; set; } = new List<SubCategory>();
    }
}