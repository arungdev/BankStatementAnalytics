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

                // Broad default taxonomy tuned for everyday spending patterns in India
                // (UPI transfers, autos/metro, DTH/mobile recharges, EMIs, chit funds, etc.).
                var defaultCategories = new List<(string Name, string[] Subs)>
                {
                    ("Food & Dining", new[] { "Groceries", "Restaurants", "Coffee", "Food Delivery", "Street Food & Snacks", "Sweets & Bakery" }),
                    ("Transportation", new[] { "Fuel", "Public Transit", "Auto & Taxi", "Cab (Ola/Uber)", "Metro", "Railways", "Flights", "Tolls & Parking", "Vehicle Maintenance" }),
                    ("Utilities", new[] { "Electricity", "Water", "Gas / LPG", "Internet / Broadband", "Mobile Recharge", "DTH / Cable", "Landline" }),
                    ("Housing", new[] { "Rent", "Home Loan EMI", "Maintenance / Society", "Property Tax", "Home Repairs", "Furniture" }),
                    ("Entertainment", new[] { "Movies", "Subscriptions (OTT)", "Games", "Events & Concerts", "Sports", "Hobbies" }),
                    ("Shopping", new[] { "Clothing", "Electronics", "Gifts", "Footwear", "Accessories", "Home & Kitchen", "Online Shopping" }),
                    ("Groceries & Household", new[] { "Supermarket", "Kirana Store", "Vegetables & Fruits", "Household Supplies", "Personal Care" }),
                    ("Health & Wellness", new[] { "Doctor / Consultation", "Medicines / Pharmacy", "Hospital", "Diagnostics / Lab", "Health Insurance", "Gym & Fitness", "Dental", "Eye Care" }),
                    ("Education", new[] { "School Fees", "College / Tuition Fees", "Coaching / Classes", "Books & Stationery", "Online Courses", "Exam Fees" }),
                    ("Personal Care", new[] { "Salon & Spa", "Grooming", "Cosmetics", "Laundry" }),
                    ("Family & Kids", new[] { "Childcare", "Kids' Education", "Toys", "Baby Products", "Elder Care" }),
                    ("Insurance", new[] { "Life Insurance", "Health Insurance", "Vehicle Insurance", "Term / Other Insurance" }),
                    ("Investments", new[] { "Mutual Funds / SIP", "Stocks", "Fixed Deposit", "Recurring Deposit", "PPF / EPF", "Gold", "Chit Fund", "Crypto" }),
                    ("Loans & EMIs", new[] { "Home Loan", "Personal Loan", "Vehicle Loan", "Credit Card Payment", "Education Loan", "Gold Loan", "Other EMIs" }),
                    ("Taxes & Fees", new[] { "Income Tax", "GST", "Bank Charges", "ATM Charges", "Late Fees", "Government Fees" }),
                    ("Financial", new[] { "Transfers", "UPI Payments", "Cash Withdrawal", "Interest Earned", "Refunds" }),
                    ("Bills & Recharges", new[] { "Mobile Recharge", "DTH Recharge", "FASTag Recharge", "Wallet Load", "Utility Bills" }),
                    ("Travel", new[] { "Hotels", "Flights", "Train Tickets", "Bus Tickets", "Holidays & Tours", "Visa & Passport" }),
                    ("Religious & Charity", new[] { "Donations", "Temple / Offerings", "Charity", "Festivals & Pooja" }),
                    ("Gifts & Occasions", new[] { "Weddings", "Birthdays", "Festivals", "Gifts Given" }),
                    ("Pets", new[] { "Pet Food", "Vet", "Pet Supplies" }),
                    ("Business", new[] { "Office Supplies", "Salaries / Wages", "Professional Services", "Business Travel", "Marketing" }),
                    ("Income", new[] { "Salary", "Business Income", "Freelance", "Rental Income", "Dividends", "Interest", "Bonus", "Cashback & Rewards" }),
                    ("Miscellaneous", new[] { "Others", "ATM Cash", "Unknown" })
                };

                foreach (var (name, subs) in defaultCategories)
                {
                    var category = new Category
                    {
                        Name = name,
                        OwnerUserId = userId,
                        SubCategories = subs.Select(s => new SubCategory { Name = s }).ToList()
                    };

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
