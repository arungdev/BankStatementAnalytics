using System.Collections.Generic;
using System.IO;
using System;
using System.Linq;
using NHibernate;
using NHibernate.Linq;
using BankStatementAnalytics.Mapping;
using BankStatementAnalytics.Mappping;
using BankStatementAnalytics.Models;
using Common.Framework.Data;
using Common.Framework.Logging;

namespace BankStatementAnalytics
{
    public static class NHibernateHelper
    {
        public static ISessionFactory SessionFactory
        {
            get
            {
                try
                {
                    return NHibernateManager.SessionFactory;
                }
                catch (InvalidOperationException)
                {
                    // Determine the true location of the executable, avoiding the single-file extract temp folder
                    var exePath = System.Diagnostics.Process.GetCurrentProcess().MainModule?.FileName;
                    var appDir = string.IsNullOrEmpty(exePath) ? AppContext.BaseDirectory : Path.GetDirectoryName(exePath);

                    var dbPath = Path.Combine(
                        appDir,
                        "Data",
                        "DataBase.db");

                    NHibernateManager.Initialize(dbPath, mapper =>
                    {
                        mapper.AddMapping<AccountMap>();
                        mapper.AddMapping<MerchantUpiMap>();
                        mapper.AddMapping<MerchantMap>();
                        mapper.AddMapping<BankTransactionMap>();
                        mapper.AddMapping<UploadMap>();
                        mapper.AddMapping<UploadTransactionMap>();
                        mapper.AddMapping<CategoryMap>();
                        mapper.AddMapping<SubCategoryMap>();
                        mapper.AddMapping<TagMap>();
                    }, IntilizeDefaultValues);

                    return NHibernateManager.SessionFactory;
                }
                catch (Exception ex)
                {
                    Log.Exception(ex);
                    throw;
                }
            }
        }

        private static void IntilizeDefaultValues(ISessionFactory sessionFactory)
        {
            SeedDefaultCategories(sessionFactory);
            SeedDefaultTags(sessionFactory);
        }
        private static void SeedDefaultTags(ISessionFactory sessionFactory)
        {
            try
            {
                using var session = sessionFactory.OpenSession();

                if (session.Query<Tag>().Any()) return;

                using var tx = session.BeginTransaction();

                var defaultTags = new List<string>
        {
            "Personal", "Business", "Tax", "Reimbursable",
            "Recurring", "One-time", "Urgent", "Review Later"
        };

                foreach (var name in defaultTags)
                    session.Save(new Tag { Name = name });

                tx.Commit();
            }
            catch (Exception ex)
            {
                Log.Exception(ex);
            }
        }


        private static void SeedDefaultCategories(ISessionFactory sessionFactory)
        {
            try
            {
                using var session = sessionFactory.OpenSession();
                
                // If any categories already exist in the DB, exit early
                if (session.Query<Category>().Any())
                {
                    return;
                }

                using var tx = session.BeginTransaction();

                var defaultCategories = new List<Category>
                {
                    new Category
                    {
                        Name = "Food & Dining",
                        SubCategories = new List<SubCategory> { new SubCategory { Name = "Groceries" }, new SubCategory { Name = "Restaurants" }, new SubCategory { Name = "Coffee" } }
                    },
                    new Category
                    {
                        Name = "Transportation",
                        SubCategories = new List<SubCategory> { new SubCategory { Name = "Fuel" }, new SubCategory { Name = "Public Transit" }, new SubCategory { Name = "Taxi" } }
                    },
                    new Category
                    {
                        Name = "Utilities",
                        SubCategories = new List<SubCategory> { new SubCategory { Name = "Electricity" }, new SubCategory { Name = "Water" }, new SubCategory { Name = "Internet" } }
                    },
                    new Category
                    {
                        Name = "Entertainment",
                        SubCategories = new List<SubCategory> { new SubCategory { Name = "Movies" }, new SubCategory { Name = "Subscriptions" }, new SubCategory { Name = "Games" } }
                    },
                    new Category
                    {
                        Name = "Shopping",
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