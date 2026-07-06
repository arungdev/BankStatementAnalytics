using BankStatementAnalytics.Models;
using Common.Framework.Data;
using Common.Framework.Logging;
using Common.Framework.Tenancy;

namespace BankStatementAnalytics.Services
{
    /// <summary>
    /// Seeds the default per-user taxonomy (categories/sub-categories/tags) for a newly
    /// created user, and migrates pre-existing single-user installs onto the new
    /// multi-tenant model. Each user gets their own private copy - nothing is shared globally.
    /// </summary>
    public static class UserProvisioningService
    {
        public static void SeedDefaultsForUser(long userId)
        {
            SeedDefaultCategories(userId);
            SeedDefaultTags(userId);
        }

        /// <summary>
        /// One-time migration for installs that had data before multi-user support existed:
        /// adopts any owner-less Account/Merchant/Category/Tag row for the first Admin created
        /// at setup. Delegates the generic backfill to Common.Framework - this method just
        /// names the app's owned entity types. Returns true if anything was adopted (a fresh
        /// install has nothing to backfill, so the caller should seed fresh defaults instead).
        /// </summary>
        public static bool BackfillOwnerlessDataTo(long userId) =>
            TenantData.BackfillOwnerlessTo(userId,
                typeof(Account), typeof(Merchant), typeof(Category), typeof(Tag));

        private static void SeedDefaultTags(long userId)
        {
            try
            {
                using var session = DbHelper.GetSession();
                using var tx = session.BeginTransaction();

                var defaultTags = new List<string>
                {
                    "Personal", "Business", "Tax", "Reimbursable",
                    "Recurring", "One-time", "Urgent", "Review Later"
                };

                foreach (var name in defaultTags)
                    session.Save(new Tag { Name = name, OwnerUserId = userId });

                tx.Commit();
            }
            catch (Exception ex)
            {
                Log.Exception(ex);
            }
        }

        private static void SeedDefaultCategories(long userId)
        {
            try
            {
                using var session = DbHelper.GetSession();
                using var tx = session.BeginTransaction();

                var defaultCategories = new List<Category>
                {
                    new Category
                    {
                        Name = "Food & Dining",
                        OwnerUserId = userId,
                        SubCategories = new List<SubCategory> { new SubCategory { Name = "Groceries" }, new SubCategory { Name = "Restaurants" }, new SubCategory { Name = "Coffee" } }
                    },
                    new Category
                    {
                        Name = "Transportation",
                        OwnerUserId = userId,
                        SubCategories = new List<SubCategory> { new SubCategory { Name = "Fuel" }, new SubCategory { Name = "Public Transit" }, new SubCategory { Name = "Taxi" } }
                    },
                    new Category
                    {
                        Name = "Utilities",
                        OwnerUserId = userId,
                        SubCategories = new List<SubCategory> { new SubCategory { Name = "Electricity" }, new SubCategory { Name = "Water" }, new SubCategory { Name = "Internet" } }
                    },
                    new Category
                    {
                        Name = "Entertainment",
                        OwnerUserId = userId,
                        SubCategories = new List<SubCategory> { new SubCategory { Name = "Movies" }, new SubCategory { Name = "Subscriptions" }, new SubCategory { Name = "Games" } }
                    },
                    new Category
                    {
                        Name = "Shopping",
                        OwnerUserId = userId,
                        SubCategories = new List<SubCategory> { new SubCategory { Name = "Clothing" }, new SubCategory { Name = "Electronics" }, new SubCategory { Name = "Gifts" } }
                    }
                };

                foreach (var category in defaultCategories)
                {
                    // Since Inverse = true on the mapping, we must set the parent reference on the child before saving
                    foreach (var sub in category.SubCategories)
                    {
                        sub.Category = category;
                    }

                    session.Save(category);
                }

                tx.Commit();
            }
            catch (Exception ex)
            {
                Log.Exception(ex);
            }
        }
    }
}
