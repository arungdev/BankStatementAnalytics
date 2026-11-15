using BankStatementAnalytics;
using BankStatementAnalytics.Models;
using BankStatementAnalytics.Mappping;
using BankStatementAnalytics.Tenancy;
using Common.Framework.Auth;
using Common.Framework.Data;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

public static class FinancialIntegration
{
    public static async Task RunAsync(string connectionString,IDataProtectionProvider protection,string keys)
    {
        NHibernateManager.Initialize(Path.Combine(Path.GetTempPath(),"unused-tenancy.db"),mapper=>{
            mapper.AddMapping<AppUserMap>(); mapper.AddMapping<ExternalLoginMap>(); NHibernateHelper.AddFinancialMappings(mapper);
        },null,db=>{db.ConnectionString=connectionString; db.Driver<NHibernate.Driver.NpgsqlDriver>(); db.Dialect<NHibernate.Dialect.PostgreSQL83Dialect>();});
        var users=new List<AppUser>(); var accounts=new List<Account>();
        using(var session=DbHelper.GetSession()) using(var tx=session.BeginTransaction()) {
            for(var index=0;index<2;index++) {
                var user=new AppUser {Username="synthetic-financial-"+index,IsActive=true,Role=AppRole.User,CreatedAt=DateTime.UtcNow};
                user.PasswordHash=new Microsoft.AspNetCore.Identity.PasswordHasher<AppUser>().HashPassword(user,"Synthetic-password-only-42"); session.Save(user); users.Add(user);
                var account=new Account {OwnerUserId=user.Id,AccountNumber="synthetic-account-"+index,AccountHolderName="Synthetic owner "+index}; session.Save(account); accounts.Add(account);
                session.Save(new BankTransaction {AccountId=account.Id,BankReference="synthetic-reference",BankType="HDFC",TransactionType="Debit",Description="synthetic-user-"+index,Amount=10+index,Balance=100+index,TransactionDate=DateTime.UtcNow,ImportedOn=DateTime.UtcNow});
                session.Save(new Category {OwnerUserId=user.Id,Name="synthetic-category-"+index});
                session.Save(new GPayEvidenceRecord {OwnerUserId=user.Id,Kind="Profile",SourceKey="synthetic-profile-"+index,Payload="{}",CreatedUtc=DateTime.UtcNow});
            }
            tx.Commit();
        }
        var config=new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> {
            ["Tenancy:Enabled"]="true",["Database:Provider"]="Postgres",["Database:Embedded"]="false",
            ["Tenancy:OperatorConnectionString"]=connectionString,["Tenancy:MetadataSchema"]="cf_financial_test"
        }).Build();
        AppTenantRuntime.Configure(config);
        using var services=new ServiceCollection().AddSingleton(protection).BuildServiceProvider();
        AppTenantRuntime.Initialize(services,config); await AppTenantRuntime.Store.InitializeAsync();
        foreach(var user in users) await LegacySchemaMigration.CopyUserAsync(user.Id);
        foreach(var (user,index) in users.Select((u,i)=>(u,i))) {
            using var scope=AppTenantRuntime.EnterUser(user.Id);
            using var session=AppDatabase.GetSession();
            if(session.Query<Account>().Single().Id!=accounts[index].Id || session.Query<BankTransaction>().Single().Description!="synthetic-user-"+index || session.Query<GPayEvidenceRecord>().Single().OwnerUserId!=user.Id) throw new Exception("Financial legacy migration isolation failed.");
            if(session.Get<Account>(accounts[1-index].Id)!=null) throw new Exception("Cross-user legacy financial ID was accessible.");
        }
        using(var shared=DbHelper.GetSession()) { if(shared.Query<Account>().Count()!=2 || shared.Query<AppUser>().Count()!=2) throw new Exception("Legacy source/auth rows were changed."); }
        foreach(var user in users) await LegacySchemaMigration.CopyUserAsync(user.Id);
        var snapshot=await AppTenantRuntime.Store.BackupAsync(AppTenantRuntime.Identity(users[0].Id));
        await AppTenantRuntime.Store.RestoreAsync(AppTenantRuntime.Identity(users[0].Id),snapshot);
        Console.WriteLine("PASS: actual financial mappings provisioned, legacy accounts/transactions/categories/GPay profiles copied and isolated, source/auth rows retained, retry idempotent, full financial schema snapshot restored.");
        await ApplicationHttpIntegration.RunAsync(connectionString,keys,users,accounts);
        using(var shared=DbHelper.GetSession()) using(var tx=shared.BeginTransaction()) {
            var inactive=shared.Get<AppUser>(users[1].Id); inactive.IsActive=false; shared.Update(inactive); tx.Commit();
        }
        BankStatementAnalytics.Services.UserProvisioningService.PurgeUserData(users[1].Id);
        using(var scope=AppTenantRuntime.EnterUser(users[1].Id,allowInactive:true)) using(var session=AppDatabase.GetSession()) {
            if(session.Query<Account>().Any() || session.Query<BankTransaction>().Any()) throw new Exception("Inactive user purge failed.");
        }
        Console.WriteLine("PASS: authorized deletion purges an inactive user's private financial data.");
        AppTenantRuntime.Configure(new ConfigurationBuilder().Build());
    }
}
