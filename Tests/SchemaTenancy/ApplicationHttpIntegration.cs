using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BankStatementAnalytics.Models;
using BankStatementAnalytics.Tenancy;
using Common.Framework.Auth;
using Npgsql;

public static class ApplicationHttpIntegration
{
    public static async Task RunAsync(string operatorString,string keys,List<AppUser> users,List<Account> accounts)
    {
        var role="test_auth_"+Guid.NewGuid().ToString("N").Substring(0,8);
        await using(var admin=new NpgsqlConnection(operatorString)) {
            await admin.OpenAsync();
            await using var command=new NpgsqlCommand($"create role {role} login password 'synthetic-auth-only'; alter database {admin.Database} owner to {role}",admin);
            await command.ExecuteNonQueryAsync();
        }
        var auth=new NpgsqlConnectionStringBuilder(operatorString) {Username=role,Password="synthetic-auth-only"};
        var old=Environment.GetEnvironmentVariable("Database__PostgresConnectionString");
        Environment.SetEnvironmentVariable("Database__Provider","Postgres"); Environment.SetEnvironmentVariable("Database__Embedded","false"); Environment.SetEnvironmentVariable("Database__PostgresConnectionString",auth.ConnectionString);
        try { await TenantOperatorCommands.RunAsync(new[] {"schema-tenancy","migrate","--stopped-writes"}); }
        finally { Environment.SetEnvironmentVariable("Database__PostgresConnectionString",old); }
        var assembly=typeof(AppDatabase).Assembly.Location;
        var executable=Path.Combine(Path.GetDirectoryName(assembly)!,OperatingSystem.IsWindows()?"BankStatementAnalytics.exe":"BankStatementAnalytics");
        var info=new ProcessStartInfo(executable) {UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,WorkingDirectory=Path.GetDirectoryName(assembly)!};
        foreach(var (key,value) in new Dictionary<string,string> {
            ["Database__Provider"]="Postgres",["Database__Embedded"]="false",["Database__PostgresConnectionString"]=auth.ConnectionString,
            ["Tenancy__Enabled"]="true",["Tenancy__MetadataSchema"]="cf_financial_test",["Tenancy__OperatorConnectionString"]=operatorString,
            ["DataProtection__KeysDirectory"]=keys,["Security__SessionsDirectory"]=Path.Combine(keys,"sessions"),
            ["Deployment__PublicHosting"]="false",["ASPNETCORE_ENVIRONMENT"]="Development",["Urls"]="http://127.0.0.1:51873",["ASPNETCORE_URLS"]="http://127.0.0.1:51873"
        }) info.Environment[key]=value;
        using var process=Process.Start(info)!;
        var stdout=process.StandardOutput.ReadToEndAsync(); var stderr=process.StandardError.ReadToEndAsync();
        try {
            using var health=new HttpClient();
            var ready=false;
            for(var retry=0;retry<60;retry++) {
                if(process.HasExited) throw new Exception("Application failed to start: "+await stdout+await stderr);
                try { var response=await health.GetAsync("http://127.0.0.1:51873/api/auth/options"); if(response.IsSuccessStatusCode){ready=true;break;} } catch(HttpRequestException) { }
                await Task.Delay(500);
            }
            if(!ready) throw new Exception("Application HTTP startup timeout.");
            byte[]? firstSnapshot=null;
            for(var index=0;index<2;index++) {
                using var client=new HttpClient(new HttpClientHandler {CookieContainer=new CookieContainer(),AllowAutoRedirect=false}) {BaseAddress=new Uri("http://127.0.0.1:51873")};
                var login=await client.PostAsJsonAsync("/api/auth/login",new {username=users[index].Username,password="Synthetic-password-only-42"});
                if(!login.IsSuccessStatusCode) throw new Exception("HTTP login failed: "+await login.Content.ReadAsStringAsync());
                var response=await client.GetAsync("/api/accounts");
                var payload=await response.Content.ReadAsStringAsync();
                using var accountPayload=JsonDocument.Parse(payload);
                if(!response.IsSuccessStatusCode || accountPayload.RootElement.GetArrayLength()!=1 || accountPayload.RootElement[0].GetProperty("id").GetInt64()!=accounts[index].Id) throw new Exception("HTTP account isolation failed: "+payload);
                var cross=await client.GetAsync($"/api/accounts/{accounts[1-index].Id}/supported-formats");
                if(cross.StatusCode!=HttpStatusCode.NotFound) throw new Exception("Cross-user HTTP financial ID accessible.");
                var backup=await client.PostAsync("/api/workspace/database-backup",null);
                if(!backup.IsSuccessStatusCode || (await backup.Content.ReadAsByteArrayAsync()).Length==0) throw new Exception("HTTP workspace database backup failed.");
                var bytes=await backup.Content.ReadAsByteArrayAsync();
                if(index==0) firstSnapshot=bytes;
                using var form=new MultipartFormDataContent();
                form.Add(new ByteArrayContent(firstSnapshot!),"file","synthetic-workspace.snapshot");
                var restore=await client.PostAsync("/api/workspace/database-backup/restore",form);
                if(index==0 && !restore.IsSuccessStatusCode || index==1 && restore.StatusCode!=HttpStatusCode.BadRequest) throw new Exception("HTTP single-user/cross-user restore boundary failed.");
            }
            Console.WriteLine("PASS: real application starts with restricted shared auth role, both users log in, HTTP financial data/ID isolation and user-specific snapshot endpoints work.");
        } finally {
            if(!process.HasExited) { process.Kill(entireProcessTree:true); await process.WaitForExitAsync(); }
            await stdout; await stderr;
        }
    }
}
