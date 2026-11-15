using System.Text;
using Microsoft.Extensions.Configuration;
using System.Data.Common;
using System.Data.SQLite;
using BankStatementAnalytics.EnumClass;
using BankStatementAnalytics.Models;
using BankStatementAnalytics.Mappping;
using BankStatementAnalytics.Migrations;
using BankStatementAnalytics.Services;
using BankStatementAnalytics.Services.Parser;
using BankStatementAnalytics.Services.Pdf;
using Common.Framework.Auth;
using Common.Framework.Data;
using Microsoft.Extensions.DependencyInjection;
using NHibernate.Mapping.ByCode;
using Npgsql;
using BankStatementAnalytics.Controllers.Api;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;

var checks = 0;
void Check(bool condition, string name) {
    if (!condition) throw new Exception(name);
    checks++; Console.WriteLine($"PASS: {name}");
}
var scratch = Path.Combine(Path.GetTempPath(), "bsa-regression-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(scratch);
var postgres = Environment.GetEnvironmentVariable("BSA_TEST_POSTGRES");
if (postgres != null && new NpgsqlConnectionStringBuilder(postgres).Database != "bsa_regression")
    throw new Exception("Postgres checks require a disposable database named bsa_regression.");
var dbPath = Path.Combine(scratch, "test.db");
var oldHash = new string('A', 64);
// Exercise the upgrade path with historical duplicate files, not just a fresh schema.
using (DbConnection connection = postgres == null
    ? new SQLiteConnection($"Data Source={dbPath};Version=3;") : new NpgsqlConnection(postgres)) {
    connection.Open();
    using var command = connection.CreateCommand();
    var dateType = postgres == null ? "DATETIME" : "TIMESTAMP";
    command.CommandText = $"CREATE TABLE uploads (id VARCHAR(50) PRIMARY KEY, filename VARCHAR(500), storedname VARCHAR(500), accountid INT, path VARCHAR(1000), uploadedat {dateType}, transactionid VARCHAR(50), filehash VARCHAR(64), totalcount INT, newcount INT, autoimported BOOLEAN)";
    command.ExecuteNonQuery();
    for (var i = 0; i < 2; i++) {
        command.CommandText = $"INSERT INTO uploads(id,filename,storedname,accountid,path,uploadedat,filehash,totalcount,newcount) VALUES('{Guid.NewGuid()}', 'historical', 'historical', 999, '', '2026-01-0{i + 1}', '{oldHash}', 0, 0)";
        command.ExecuteNonQuery();
    }
}
NHibernateManager.Initialize(dbPath, mapper => {
    mapper.AddMapping<AppUserMap>();
    mapper.AddMappings(typeof(AccountMap).Assembly.GetTypes().Where(t =>
        typeof(IConformistHoldersProvider).IsAssignableFrom(t) && !t.IsAbstract));
}, null, postgres == null ? null : db => {
    db.ConnectionString = postgres;
    db.Driver<NHibernate.Driver.NpgsqlDriver>();
    db.Dialect<NHibernate.Dialect.PostgreSQL83Dialect>();
}, configureMigrations: AppMigrations.Register);

using (var session = DbHelper.GetSession()) {
    Check(session.Query<Upload>().Count() == 2 && session.Query<Upload>().Count(u => u.FileHash == oldHash) == 1,
        "migration retains historical uploads while reserving one identical hash");
}

var services = new ServiceCollection();
services.AddSingleton<PdfStatementReader>();
services.AddScoped<CounterPartyService>();
services.AddScoped<RuleEngineService>();
services.AddScoped<TextService>();
services.AddScoped<StatementImportService>();
foreach (var parser in BankParserRegistry.Parsers) services.AddScoped(parser.ParserType);
using var provider = services.BuildServiceProvider();
using var scope = provider.CreateScope();
var importer = scope.ServiceProvider.GetRequiredService<StatementImportService>();
var textService = scope.ServiceProvider.GetRequiredService<TextService>();
var account = new Account { OwnerUserId = 101, BankName = Bank.HDFC, AccountNumber = "synthetic-" + Guid.NewGuid().ToString("N"), AccountHolderName = "Synthetic" };
var other = new Account { OwnerUserId = 202, BankName = Bank.HDFC, AccountNumber = "synthetic-other-" + Guid.NewGuid().ToString("N"), AccountHolderName = "Synthetic" };
using (var session = DbHelper.GetSession()) using (var transaction = session.BeginTransaction()) {
    session.Save(account); session.Save(other); transaction.Commit();
}
const string header = "Date,Narration,Value Date,Withdrawal Amt,Deposit Amt,Chq/Ref Number,Closing Balance\n";
const string rows = "01/10/26,UPI-ALICE-TESTBANK-123456789012,01/10/26,100.00,,REF1,900.00\n02/10/26,UPI-BOB-TESTBANK-123456789013,02/10/26,,50.00,REF2,950.00\n";
var bytes = Encoding.UTF8.GetBytes(header + rows);
var first = await importer.ImportAsync(account, bytes, "synthetic.txt", null, false);
Check(first.Outcome == ImportOutcome.Success && first.Total == 2 && first.NewCount == 2, "HDFC import commits its complete row count");
Check(first.Upload?.ImportStatus == "Complete" && File.Exists(UploadStorage.ResolvePath(first.Upload.StoredName)), "complete import retains its source file");
Check((await importer.ImportAsync(account, bytes, "renamed.txt", null, true)).Outcome == ImportOutcome.Duplicate,
    "renaming a file or switching to auto-import cannot bypass deduplication");
using (var session = DbHelper.GetSession()) using (var transaction = session.BeginTransaction()) {
    var row = session.Query<BankTransaction>().Single(t => t.AccountId == account.Id && t.BankReference == "REF1");
    row.Note = "keep my note"; row.Tags = "custom"; row.CategoryOverride = "Custom category";
    transaction.Commit();
}
var overlap = await importer.ImportAsync(account, Encoding.UTF8.GetBytes(header + rows + "03/10/26,UPI-CAROL-TESTBANK-123456789014,03/10/26,25.00,,REF3,925.00\n"), "overlap.txt", null, false);
Check(overlap.Total == 3 && overlap.NewCount == 1, "overlapping statements only insert unseen references");
using (var session = DbHelper.GetSession()) {
    var edited = session.Query<BankTransaction>().Single(t => t.AccountId == account.Id && t.BankReference == "REF1");
    Check(edited.Note == "keep my note" && edited.Tags == "custom" && edited.CategoryOverride == "Custom category" && edited.UploadId == first.Upload!.Id,
        "overlap preserves user edits and original upload ownership");
    Check(AccountAccess.OwnedIds(session, 101).SequenceEqual(new[] { account.Id }), "account scope excludes another user's account");
    Check(AccountAccess.FilterOwned($"{account.Id},{other.Id}", AccountAccess.OwnedIdSet(session, 101)).SequenceEqual(new[] { account.Id }),
        "requested cross-user account IDs are excluded");
    var summaries = AccountSummaryQueries.Latest(session, new[] { account.Id });
    Check(summaries[account.Id].Balance == 925m && summaries[account.Id].TransactionDate.Day == 3, "batched account summary returns the latest balance");
}
Check((await importer.ImportAsync(other, bytes, "other.txt", null, false)).Outcome == ImportOutcome.Success,
    "file deduplication is scoped to each account");
var concurrentBytes = Encoding.UTF8.GetBytes(header + "04/10/26,UPI-RACE-TESTBANK-123456789015,04/10/26,10.00,,RACE1,915.00\n");
var simultaneous = await Task.WhenAll(importer.ImportAsync(account, concurrentBytes, "race-manual.txt", null, false),
    importer.ImportAsync(account, concurrentBytes, "race-watched.txt", null, true));
Check(simultaneous.Count(r => r.Outcome == ImportOutcome.Success) == 1 && simultaneous.Count(r => r.Outcome == ImportOutcome.Duplicate) == 1,
    "simultaneous manual and watched imports commit one copy");
var overlappingRace = await Task.WhenAll(
    importer.ImportAsync(account, Encoding.UTF8.GetBytes(header + "05/10/26,UPI-OVERLAP-TESTBANK-123456789016,05/10/26,5.00,,RACE2,910.00\n"), "race-a.txt", null, false),
    importer.ImportAsync(account, Encoding.UTF8.GetBytes(header + "05/10/26,UPI-OVERLAP-TESTBANK-123456789016,05/10/26,5.00,,RACE2,910.00\n\n"), "race-b.txt", null, true));
Check(overlappingRace.All(r => r.Outcome == ImportOutcome.Success) && overlappingRace.Sum(r => r.NewCount) == 1,
    "different concurrent files with overlapping references add the row once");
var invalid = await importer.ImportAsync(account, Encoding.UTF8.GetBytes("unparseable"), "invalid.txt", null, false);
Check(invalid.Outcome == ImportOutcome.InvalidFile, "zero parsed transactions are rejected");
using (var session = DbHelper.GetSession())
    Check(!session.Query<Upload>().Any(u => u.FileName == "invalid.txt"), "failed parsing removes the hash reservation");

// Roll back after inserts/merchant resolution, simulating failure before commit.
var rollbackId = Guid.NewGuid();
var prepared = new PreparedStatement([new BankTransaction { AccountId = account.Id, BankReference = "ROLLBACK", BankType = "HDFC", TransactionType = "DR", Debit = 12m, Amount = 12m, TransactionDate = new(2026, 10, 4), PendingCounterPartyName = "Rollback Merchant" }], null, []);
using (var session = DbHelper.GetSession()) using (var transaction = session.BeginTransaction()) {
    await textService.PersistAsync(session, account, rollbackId, prepared);
    await session.FlushAsync();
    await transaction.RollbackAsync();
}
using (var session = DbHelper.GetSession()) {
    Check(!session.Query<BankTransaction>().Any(t => t.BankReference == "ROLLBACK"), "financial rows roll back on commit-stage failure");
    Check(!session.Query<Merchant>().Any(m => m.Name == "Rollback Merchant"), "new merchants roll back with financial rows");
}
var pending = new Upload { Id = Guid.NewGuid(), AccountId = (int)account.Id, FileName = "interrupted.txt", StoredName = UploadStorage.AccountFolderName(account) + "/interrupted.txt", ImportStatus = "Pending", FileHash = new string('B', 64) };
var deleting = new Upload { Id = Guid.NewGuid(), AccountId = (int)account.Id, FileName = "reverted.txt", StoredName = UploadStorage.AccountFolderName(account) + "/reverted.txt", ImportStatus = "Deleting" };
File.WriteAllText(UploadStorage.ResolvePath(pending.StoredName), "partial");
File.WriteAllText(UploadStorage.ResolvePath(deleting.StoredName), "reverted");
using (var session = DbHelper.GetSession()) using (var transaction = session.BeginTransaction()) {
    session.Save(pending); session.Save(deleting); transaction.Commit();
}
ImportRecovery.RecoverPending();
using (var session = DbHelper.GetSession()) {
    Check(session.Get<Upload>(pending.Id) == null && !File.Exists(UploadStorage.ResolvePath(pending.StoredName)), "startup recovers interrupted imports and removes partial files");
    Check(session.Get<Upload>(first.Upload!.Id) != null, "recovery preserves completed imports");
    Check(session.Get<Upload>(deleting.Id) == null && !File.Exists(UploadStorage.ResolvePath(deleting.StoredName)), "startup finishes interrupted revert file cleanup");
}
var separator = PdfStatementReader.CellSeparator;
var hdfc = new HdfcPdfParser().Parse(string.Join(separator, "01/10/26", "UPI-TEST", "PDFREF", "01/10/26", "1,234.50", "", "8,765.50"), 17).ToList();
Check(hdfc.Count == 1 && hdfc[0].Debit == 1234.50m && hdfc[0].AccountId == 17, "HDFC normalized PDF parses comma amounts");
var iob = new IobPdfParser().Parse(string.Join(separator, "01/10/2026", "01/10/2026", "", "UPI/123456789012/ALICE", "TRF", "TRF 445.00", "", "555.00"), 18).ToList();
Check(iob.Count == 1 && iob[0].Debit == 445m && iob[0].Balance == 555m, "IOB normalized PDF handles adjacent TRF markers");
var balances = new[] { new BankTransaction { TransactionDate = new(2026, 10, 1), Balance = 100m }, new BankTransaction { TransactionDate = new(2026, 10, 2), Debit = 20m, Balance = 80m } };
Check(BalanceContinuity.FindGaps(balances).Count == 0 && BalanceContinuity.FindGaps(balances.Reverse().ToArray()).Count == 0, "balance reconciliation handles both statement orders");
balances[1].Balance = 79m;
Check(BalanceContinuity.FindGaps(balances).Count == 1, "balance discrepancies are available to the review UI");

var keys = new DirectoryInfo(Path.Combine(scratch, "keys"));
var protector = new StatementPasswordProtector(keys);
var protectedPassword = protector.Protect("synthetic-password")!;
Check(protectedPassword != "synthetic-password" && protector.Unprotect(protectedPassword) == "synthetic-password", "saved statement passwords are protected and readable");
var restoredKeys = new DirectoryInfo(Path.Combine(scratch, "restored-keys")); restoredKeys.Create();
foreach (var file in keys.GetFiles()) file.CopyTo(Path.Combine(restoredKeys.FullName, file.Name));
Check(new StatementPasswordProtector(restoredKeys).Unprotect(protectedPassword) == "synthetic-password", "restored key ring decrypts a backed-up password");
account.StatementPassword = "legacy-password";
using (var session = DbHelper.GetSession()) using (var transaction = session.BeginTransaction()) { session.Update(account); transaction.Commit(); }
ImportRecovery.ProtectLegacyPasswords(protector);
using (var session = DbHelper.GetSession()) {
    var migrated = session.Get<Account>(account.Id).StatementPassword!;
    Check(protector.IsProtected(migrated) && protector.Unprotect(migrated) == "legacy-password", "startup converts legacy plaintext passwords");
}
Check(!System.Text.Json.JsonSerializer.Serialize(account).Contains("StatementPassword"), "account serialization omits saved passwords");
var controller = new StatementApiController(importer, protector) {
    ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext {
        User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, "101")], "regression")) } }
};
Check(await controller.GetTransactions((int)other.Id) is NotFoundResult, "transaction endpoint refuses another user's account");
Check(await controller.Upload(null!, (int)other.Id) is NotFoundResult, "upload endpoint checks ownership before processing a file");
Check(controller.GetUploads((int)other.Id) is NotFoundResult, "upload history endpoint refuses another user's account");
var passwordController = new AccountApiController(protector) { ControllerContext = controller.ControllerContext };
using var watcherServices = new ServiceCollection().BuildServiceProvider();
var passwordWatcher = new WatchFolderImportService(watcherServices.GetRequiredService<IServiceScopeFactory>());
Check(await passwordController.UpdateStatementPassword((int)other.Id, new() { Password = "test" }, passwordWatcher) is NotFoundResult,
    "password settings refuse another user's account");
Check(await passwordController.UpdateStatementPassword((int)account.Id, new() { Password = new string('x', 201) }, passwordWatcher) is BadRequestObjectResult,
    "password settings reject oversized passwords");
Check(await passwordController.UpdateStatementPassword((int)account.Id, new() { Password = "upload-secret" }, passwordWatcher) is OkObjectResult,
    "account owner can save a password without host-folder permissions");
using (var session = DbHelper.GetSession()) {
    var saved = session.Get<Account>(account.Id).StatementPassword!;
    Check(protector.IsProtected(saved) && protector.Unprotect(saved) == "upload-secret", "password endpoint persists encrypted values");
}
Check(await passwordController.UpdateStatementPassword((int)account.Id, new() { Password = "" }, passwordWatcher) is OkObjectResult,
    "account owner can clear a saved password");
using (var session = DbHelper.GetSession())
    Check(string.IsNullOrEmpty(session.Get<Account>(account.Id).StatementPassword), "clearing removes the saved secret");
using (var lifecycleWatcher = new WatchFolderImportService(watcherServices.GetRequiredService<IServiceScopeFactory>()))
{
    await lifecycleWatcher.StartAsync(CancellationToken.None);
    var sharedSweep = lifecycleWatcher.TriggerSweepAsync();
    using var cancelledWait = new CancellationTokenSource();
    var callerSweep = lifecycleWatcher.TriggerSweepAsync(cancelledWait.Token);
    cancelledWait.Cancel();
    try { await callerSweep; throw new Exception("cancelled sweep wait completed normally"); }
    catch (OperationCanceledException) { Check(!sharedSweep.IsCompleted, "cancelling one import-now caller preserves the shared sweep"); }
    await lifecycleWatcher.StopAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(5));
    Check(sharedSweep.IsCanceled, "watcher shutdown cancels queued import-now requests during startup");
    Check(lifecycleWatcher.TriggerSweepAsync().IsCanceled, "a stopped watcher never queues requests that cannot finish");
}
Check(await controller.GetAccounts() is OkObjectResult, "account endpoint executes batched summaries with tenant scope");
var card = new Account { OwnerUserId = 101, BankName = Bank.HDFCCreditCard, AccountNumber = "synthetic-card", AccountHolderName = "Synthetic" };
var emptyCard = new Account { OwnerUserId = 101, BankName = Bank.HDFCCreditCard, AccountNumber = "synthetic-empty", AccountHolderName = "Synthetic" };
using (var session = DbHelper.GetSession()) using (var transaction = session.BeginTransaction()) {
    session.Save(card); session.Save(emptyCard);
    session.Save(new BankTransaction { AccountId = card.Id, BankReference = "CARD-OLD", BankType = "HDFCCC", TransactionType = "DR", Debit = 1000m, Amount = 1000m, TransactionDate = new(2026, 10, 1) });
    session.Save(new BankTransaction { AccountId = card.Id, BankReference = "CARD-NEW", BankType = "HDFCCC", TransactionType = "DR", Debit = 150m, Amount = 150m, TransactionDate = new(2026, 10, 3) });
    session.Save(new BankTransaction { AccountId = card.Id, BankReference = "CARD-PAY", BankType = "HDFCCC", TransactionType = "CR", Credit = 50m, Amount = 50m, TransactionDate = new(2026, 10, 4) });
    transaction.Commit();
}
using (var session = DbHelper.GetSession()) {
    var summaries = new Dictionary<long, CardStatementSummary> { [card.Id] = new() { AccountId = card.Id, StatementDate = new(2026, 10, 2), TotalDue = 400m } };
    var cardBalances = AccountSummaryQueries.CardBalances(session, new[] { card.Id, emptyCard.Id }, summaries);
    Check(cardBalances[card.Id] == 500m && cardBalances[emptyCard.Id] == null, "batched card balances anchor to statement dues and preserve unknown balances");
    Check(AccountSummaryQueries.CardBalances(session, new[] { card.Id }, new Dictionary<long, CardStatementSummary>())[card.Id] == 1100m,
        "card balance without a statement uses net activity");
}
try { UploadStorage.ResolvePath("../outside.txt"); throw new Exception("unsafe path accepted"); }
catch (ArgumentException) { Check(true, "stored statement paths cannot escape the upload directory"); }
var searchController = new SearchApiController { ControllerContext = controller.ControllerContext };
var searchResult = (OkObjectResult)await searchController.Search("CARD-");
var searchJson = System.Text.Json.JsonSerializer.SerializeToElement(searchResult.Value);
var searchRows = searchJson.GetProperty("transactions").EnumerateArray().ToList();
Check(searchRows.Count == 3 && searchRows.All(row => row.GetProperty("accountId").GetInt64() == card.Id),
    "global search projects bounded transaction results within owned accounts");
using (var cancelledSearch = new CancellationTokenSource()) {
    cancelledSearch.Cancel();
    try { await searchController.Search("CARD-", cancelledSearch.Token); throw new Exception("cancelled search continued"); }
    catch (OperationCanceledException) { Check(true, "cancelled search stops database work"); }
}
SecurityRuntime.Configure(new Microsoft.Extensions.Configuration.ConfigurationBuilder()
    .AddInMemoryCollection(new Dictionary<string, string?> { ["Deployment:PublicHosting"] = "true" }).Build());
var originalsBefore = Directory.Exists(UploadStorage.Root)
    ? Directory.GetFiles(UploadStorage.Root, "*", SearchOption.AllDirectories).Order().ToArray() : Array.Empty<string>();
var cloudBytes = Encoding.UTF8.GetBytes(header + "04/10/26,UPI-CLOUD-TESTBANK-123456789099,04/10/26,10.00,,CLOUD1,890.00\n");
var cloud = await importer.ImportAsync(account, cloudBytes, "cloud-synthetic.txt", null, false);
Check(cloud.Outcome == ImportOutcome.Success && cloud.NewCount == 1, "cloud imports still commit financial records");
Check(cloud.Upload is { StoredName: "", Path: "", ImportStatus: "Complete" }, "cloud history contains no original-file location");
var originalsAfter = Directory.Exists(UploadStorage.Root)
    ? Directory.GetFiles(UploadStorage.Root, "*", SearchOption.AllDirectories).Order().ToArray() : Array.Empty<string>();
Check(originalsBefore.SequenceEqual(originalsAfter), "cloud upload writes no original file to storage");
Check((await importer.ImportAsync(other, cloudBytes, "same-cloud.txt", null, false)).Outcome == ImportOutcome.Success,
    "different users can independently import identical statements");
Check((await importer.ImportAsync(account, cloudBytes, "renamed-cloud.txt", null, false)).Outcome == ImportOutcome.Duplicate,
    "cloud deduplication remains scoped to the owning account");
Check((await importer.ImportAsync(account, "MZsynthetic"u8.ToArray(), "fake.csv", null, false)).Outcome == ImportOutcome.InvalidFile,
    "executable signature cannot masquerade as a text statement");
Check((await importer.ImportAsync(account, "not a PDF"u8.ToArray(), "fake.pdf", null, false)).Outcome == ImportOutcome.InvalidFile,
    "PDF extension requires PDF content");
var gpay = new GPayTakeoutService();
var profileController = new SplitGroupsApiController(null!, gpay) { ControllerContext = controller.ControllerContext };
Check(await profileController.UpdateProfilePreferences(new() { UserName = "Cloud Alice", BankAccountIds = [account.Id] }) is OkObjectResult,
    "cloud user can update profile preferences through the public API");
Check(await profileController.UpdateProfilePreferences(new() { WatchFolderPath = scratch }) is BadRequestObjectResult,
    "profile preferences endpoint refuses server-folder changes");
Check(await profileController.UpdateProfilePreferences(new() { WatchEnabled = false }) is BadRequestObjectResult,
    "profile preferences endpoint refuses watcher changes including disabling");
Check(await profileController.UpdateProfilePreferences(new() { BankAccountIds = [other.Id] }) is BadRequestObjectResult,
    "profile preferences endpoint refuses another user's accounts");
await gpay.UpdateAutoImportConfigAsync(101, new UpdateGPayAutoImportRequest { UserName = "Synthetic Alice", BankAccountIds = [account.Id] });
await gpay.UpdateAutoImportConfigAsync(202, new UpdateGPayAutoImportRequest { UserName = "Synthetic Bob", BankAccountIds = [other.Id] });
Check((await gpay.GetAutoImportConfigAsync(101)).UserName == "Synthetic Alice" &&
    (await gpay.GetAutoImportConfigAsync(202)).UserName == "Synthetic Bob", "GPay primary configuration is isolated per user");
try { await gpay.UpdateAutoImportConfigAsync(101, new UpdateGPayAutoImportRequest { BankAccountIds = [other.Id] }); throw new Exception("cross-user GPay account accepted"); }
catch (ArgumentException) { Check(true, "GPay configuration rejects another user's bank account"); }
try { await gpay.UpdateAutoImportConfigAsync(101, new UpdateGPayAutoImportRequest { WatchEnabled = true, WatchFolderPath = scratch }); throw new Exception("cloud watch folder accepted"); }
catch (ArgumentException) { Check(true, "cloud GPay configuration rejects server watch folders"); }
var emptyProfile = await gpay.CreateProfileAsync(101, new CreateGPayProfileRequest { Name = "Disposable GPay", UserName = "Synthetic Alice", BankAccountIds = [account.Id] });
try { await gpay.DeleteProfileAsync(202, emptyProfile.ProfileId!); throw new Exception("another user's GPay profile was deleted"); }
catch (ArgumentException) { Check(true, "GPay profile deletion is restricted to its owner"); }
try { await gpay.DeleteProfileAsync(101, "default"); throw new Exception("Primary GPay was deleted"); }
catch (ArgumentException) { Check(true, "Primary GPay cannot be deleted"); }
int bankRowsBeforeDelete;
using (var session = DbHelper.GetSession()) bankRowsBeforeDelete = session.Query<BankTransaction>().Count();
var afterProfileDelete = await gpay.DeleteProfileAsync(101, emptyProfile.ProfileId!);
Check(afterProfileDelete.ProfileId == null && afterProfileDelete.UserName == "Synthetic Alice"
    && !afterProfileDelete.Profiles.Any(p => p.Id == emptyProfile.ProfileId), "empty profile deletion returns to Primary GPay and preserves its configuration");
using (var session = DbHelper.GetSession()) Check(session.Query<BankTransaction>().Count() == bankRowsBeforeDelete
    && session.Query<Account>().Any(a => a.Id == account.Id), "profile deletion preserves bank transactions and accounts");
var protectedProfile = await gpay.CreateProfileAsync(101, new CreateGPayProfileRequest { Name = "Imported GPay", UserName = "Synthetic Alice" });
using (var session = DbHelper.GetSession()) using (var tx = session.BeginTransaction()) {
    await session.SaveAsync(new GPayEvidenceRecord { OwnerUserId = 101, Kind = "Batch", SourceKey = "synthetic-profile-batch", Payload = System.Text.Json.JsonSerializer.Serialize(new { ProfileId = protectedProfile.ProfileId }) });
    await tx.CommitAsync();
}
try { await gpay.DeleteProfileAsync(101, protectedProfile.ProfileId!); throw new Exception("profile with imported evidence was deleted"); }
catch (InvalidOperationException) { Check(true, "profile deletion protects imported evidence even when there are no groups"); }
Check((await gpay.ListProfilesAsync(101)).Any(p => p.Id == protectedProfile.ProfileId), "rejected deletion preserves the profile");
var groupProfile = await gpay.CreateProfileAsync(101, new CreateGPayProfileRequest { Name = "Group GPay", UserName = "Synthetic Alice" });
using (var session = DbHelper.GetSession()) using (var tx = session.BeginTransaction()) {
    await session.SaveAsync(new BillGroup { OwnerUserId = 101, Name = "Synthetic profile group", GPayProfileId = groupProfile.ProfileId });
    await tx.CommitAsync();
}
try { await gpay.DeleteProfileAsync(101, groupProfile.ProfileId!); throw new Exception("profile with a group was deleted"); }
catch (InvalidOperationException) { Check(true, "profile deletion protects existing groups"); }
var syncProfile = await gpay.CreateProfileAsync(101, new CreateGPayProfileRequest { Name = "Sync history GPay", UserName = "Synthetic Alice", BankAccountIds = [account.Id] });
var syncDocument = System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(new GPayTakeoutData { GroupExpenses = [new GPayExpenseItem {
    CreationTime = "2026-10-02T12:00:00Z", Creator = "Synthetic Alice", GroupName = "History group", Title = "History lunch", TotalAmount = "₹300",
    Items = [new GPayExpenseMemberItem { Payer = "Synthetic Alice", Amount = "₹150", State = "PAID_RECEIVED" }, new GPayExpenseMemberItem { Payer = "Synthetic Friend", Amount = "₹150", State = "PENDING" }]
}] });
using (var stream = new MemoryStream(syncDocument)) Check((await gpay.ImportFromStreamAsync(101, stream, "history.json", profileId: syncProfile.ProfileId)).Success, "recorded profile upload succeeds");
using (var stream = new MemoryStream(syncDocument)) Check((await gpay.ImportFromStreamAsync(101, stream, "renamed-history.json", profileId: syncProfile.ProfileId)).Success, "repeated profile upload succeeds without inserting duplicates");
var historyJson = System.Text.Json.JsonSerializer.SerializeToElement(await gpay.SyncHistoryAsync(101, syncProfile.ProfileId));
var historyRuns = historyJson.GetProperty("Runs").EnumerateArray().ToList();
Check(historyRuns.Count == 2 && historyRuns.All(run => run.GetProperty("Status").GetString() == "Success"), "each upload has a separate successful history entry");
Check(historyRuns[0].GetProperty("Added").GetInt32() == 0 && historyRuns[0].GetProperty("Updated").GetInt32() == 0 && historyRuns[0].GetProperty("Unchanged").GetInt32() == 1, "no-op sync history records unchanged sources rather than reporting updates");
var firstHistoryId = historyRuns[1].GetProperty("Id").GetInt32();
var singleHistoryPage = System.Text.Json.JsonSerializer.SerializeToElement(await gpay.SyncHistoryAsync(101, syncProfile.ProfileId, pageSize: 1));
Check(singleHistoryPage.GetProperty("Runs").GetArrayLength() == 1 && singleHistoryPage.GetProperty("Total").GetInt32() == 2, "history respects the selected page size while retaining its total");
var clampedHistoryPage = System.Text.Json.JsonSerializer.SerializeToElement(await gpay.SyncHistoryAsync(101, syncProfile.ProfileId, page: 999, pageSize: 1));
Check(clampedHistoryPage.GetProperty("Page").GetInt32() == 1 && clampedHistoryPage.GetProperty("Runs").GetArrayLength() == 1, "restored history pagination clamps to the last available page");
try { await gpay.SyncHistoryAsync(101, syncProfile.ProfileId, pageSize: 10000); throw new Exception("unbounded history page size accepted"); }
catch (ArgumentException) { Check(true, "history rejects unbounded page sizes"); }
var syncDetailsJson = System.Text.Json.JsonSerializer.SerializeToElement(await gpay.SyncDetailsAsync(101, syncProfile.ProfileId, firstHistoryId));
var historyChanges = syncDetailsJson.GetProperty("Run").GetProperty("Changes").EnumerateArray().ToList();
Check(historyChanges.Any(change => change.GetProperty("Kind").GetString() == "Split" && change.GetProperty("Description").GetString() == "History lunch")
    && historyChanges.Any(change => change.GetProperty("Kind").GetString() == "Expense"), "sync details include committed financial rows and source additions");
try { await gpay.SyncDetailsAsync(202, syncProfile.ProfileId, firstHistoryId); throw new Exception("another user read sync history"); }
catch (ArgumentException) { Check(true, "sync details cannot be read by another user"); }
try { await gpay.SyncDetailsAsync(101, protectedProfile.ProfileId, firstHistoryId); throw new Exception("another profile read sync history"); }
catch (ArgumentException) { Check(true, "sync details are restricted to their GPay profile"); }
try { using var brokenStream = new MemoryStream("invalid JSON"u8.ToArray()); await gpay.ImportFromStreamAsync(101, brokenStream, "broken.json", profileId: syncProfile.ProfileId); throw new Exception("broken import succeeded"); }
catch (ArgumentException) { Check(true, "broken sync preserves its failure"); }
historyJson = System.Text.Json.JsonSerializer.SerializeToElement(await gpay.SyncHistoryAsync(101, syncProfile.ProfileId));
Check(historyJson.GetProperty("Runs")[0].GetProperty("Status").GetString() == "Failed", "failed imports are retained in profile sync history");
var tileJson = System.Text.Json.JsonSerializer.SerializeToElement(await gpay.ProfileDetailsAsync(101, syncProfile.ProfileId, "splits"));
Check(tileJson.GetProperty("Total").GetInt32() == (await gpay.GetAutoImportConfigAsync(101, syncProfile.ProfileId)).TotalSplits
    && tileJson.GetProperty("Records")[0].GetProperty("Title").GetString() == "History lunch", "split tile details agree with the selected profile's count");
var groupTile = System.Text.Json.JsonSerializer.SerializeToElement(await gpay.ProfileDetailsAsync(101, syncProfile.ProfileId, "groups", search: "Synthetic Friend"));
Check(groupTile.GetProperty("Total").GetInt32() == 1 && groupTile.GetProperty("Records")[0].GetProperty("Members")[0].GetString() == "Synthetic Friend",
    "group details expose a structured member list and support member search");
var noTileMatches = System.Text.Json.JsonSerializer.SerializeToElement(await gpay.ProfileDetailsAsync(101, protectedProfile.ProfileId, "splits", search: "History lunch"));
Check(noTileMatches.GetProperty("Total").GetInt32() == 0, "detail search cannot return another profile's records");
var sourceActivity = new GPayUpiActivityItem { Type = "Paid", Amount = 777.33m, Timestamp = new DateTime(2026, 10, 2), CounterPartyName = "Synthetic Merchant", RefId = "history-activity", AccountSuffix = "different", Status = "Completed" };
async Task<(List<GPaySyncChange> Changes, int Unchanged)> StoreHistoryActivity() {
    var bundle = new GPayBundle { FileName = "synthetic.zip", ArchiveHash = "synthetic-history", ProfileId = syncProfile.ProfileId };
    bundle.Records.Add(new GPaySourceRow("Activity", "history-activity", System.Text.Json.JsonSerializer.Serialize(sourceActivity)));
    using var session = DbHelper.GetSession(); using var tx = session.BeginTransaction();
    var changes = await GPayEvidenceService.StoreBundle(session, 101, bundle); await tx.CommitAsync(); return changes;
}
Check((await StoreHistoryActivity()).Changes.Single().Action == "Added", "source audit reports a newly inserted payment");
sourceActivity.UpiTransactionId = "132100099999";
Check((await StoreHistoryActivity()).Changes.Single().Action == "Updated", "source audit reports a newly populated UPI ID as an update");
Check((await StoreHistoryActivity()).Unchanged == 1, "source audit reports repeated payments as unchanged");
using (var session = DbHelper.GetSession()) using (var tx = session.BeginTransaction()) {
    await session.SaveAsync(new BankTransaction { AccountId = account.Id, BankReference = "132100099999", BankType = "HDFC", TransactionType = "DR", TransactionDate = sourceActivity.Timestamp, Debit = 777.33m, Mode = "UPI", Description = "Synthetic Merchant", Note = "Keep this personal note" });
    await tx.CommitAsync();
}
var historyLinks = await new GPayEvidenceService().AutoMatchActivities(101, syncProfile.ProfileId, restrictToProfile: true);
Check(historyLinks.Linked == 1 && historyLinks.Changes?.Single().Action == "Linked", "automatic matching reports the exact committed bank link for sync auditing");
var upiTile = System.Text.Json.JsonSerializer.SerializeToElement(await gpay.ProfileDetailsAsync(101, syncProfile.ProfileId, "upi"));
Check(upiTile.GetProperty("Total").GetInt32() == 1 && (await gpay.GetAutoImportConfigAsync(101, syncProfile.ProfileId)).UpiActivitiesEnriched == 1, "UPI tile details and cumulative profile count agree");
var googleIdentities = new GoogleIdentityService();
var firstGoogle = await googleIdentities.SignInCloudAsync("visitor-first", "visitor@example.invalid", "Visitor");
Check(firstGoogle.Role == AppRole.User, "the first Google visitor can sign up without an owner and receives only a regular role");
var nextGoogle = await googleIdentities.SignInCloudAsync("next-subject", "next@example.invalid", "Next");
Check(nextGoogle.Role == AppRole.User, "later Google signups never become administrators");
var googleAlice = await googleIdentities.SignInCloudAsync("alice-subject", "alice@example.invalid", "Alice");
var googleBob = await googleIdentities.SignInCloudAsync("bob-subject", "bob@example.invalid", "Bob");
Check(googleAlice.Id != googleBob.Id && googleAlice.Role == AppRole.User && googleBob.Role == AppRole.User, "Google signup creates separate regular-user workspaces without passwords or linking");
Check((await googleIdentities.SignInCloudAsync("alice-subject", "alice@example.invalid", "Alice")).Id == googleAlice.Id, "returning Google sign-in reuses the subject's existing workspace");
var sameEmail = await googleIdentities.SignInCloudAsync("different-subject", "alice@example.invalid", "Other");
Check(sameEmail.Id != googleAlice.Id, "matching email never merges different Google subjects or their data");
using (var session = DbHelper.GetSession()) {
    var profile = session.Query<ExternalLogin>().Single(x => x.UserId == googleAlice.Id);
    Check(profile.Email == "alice@example.invalid" && profile.DisplayName == "Alice", "Google user information is stored with that user's identity");
    Check(!session.Query<Account>().Any(x => x.OwnerUserId == googleAlice.Id || x.OwnerUserId == googleBob.Id), "new Google workspaces do not adopt existing accounts or financial records");
}
using (var session = DbHelper.GetSession()) using (var transaction = session.BeginTransaction()) {
    session.Get<AppUser>(googleBob.Id).IsActive = false; transaction.Commit();
}
try { await googleIdentities.SignInCloudAsync("bob-subject", "bob@example.invalid", "Bob"); throw new Exception("disabled Google user accepted"); }
catch (InvalidOperationException) { Check(true, "disabled users cannot regain access by signing up with the same Google subject"); }
var priorGoogleAccount = new Account { OwnerUserId = googleAlice.Id, BankName = Bank.HDFC, AccountNumber = "synthetic-google-existing", AccountHolderName = "Synthetic" };
using (var session = DbHelper.GetSession()) using (var transaction = session.BeginTransaction()) {
    session.Get<AppUser>(googleAlice.Id).Role = AppRole.Admin;
    session.Save(priorGoogleAccount); transaction.Commit();
}
var formerAdmin = await googleIdentities.SignInCloudAsync("alice-subject", "alice@example.invalid", "Alice");
Check(formerAdmin.Id == googleAlice.Id && formerAdmin.Role == AppRole.User, "a previous Google administrator returns as a regular user in the same workspace");
using (var session = DbHelper.GetSession()) Check(session.Get<Account>(priorGoogleAccount.Id).OwnerUserId == formerAdmin.Id,
    "removing a Google administrator role preserves existing account ownership");
async Task<bool> PasswordRequestDenied(bool cloud, string scheme)
{
    var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> { ["Deployment:PublicHosting"] = cloud.ToString() }).Build();
    var http = new DefaultHttpContext(); http.Request.Scheme = scheme; http.Request.Method = "POST"; http.Request.Path = "/api/auth/login";
    var action = new ActionContext(http, new Microsoft.AspNetCore.Routing.RouteData(), new Microsoft.AspNetCore.Mvc.Abstractions.ActionDescriptor());
    var filters = new List<Microsoft.AspNetCore.Mvc.Filters.IFilterMetadata>();
    var context = new Microsoft.AspNetCore.Mvc.Filters.ResourceExecutingContext(action, filters, new List<Microsoft.AspNetCore.Mvc.ModelBinding.IValueProviderFactory>());
    var filter = new SecurityBoundaryFilter(config, new RegressionEnvironment(), Microsoft.Extensions.Logging.Abstractions.NullLogger<SecurityBoundaryFilter>.Instance);
    await filter.OnResourceExecutionAsync(context, () => Task.FromResult(new Microsoft.AspNetCore.Mvc.Filters.ResourceExecutedContext(action, filters)));
    return context.Result is ObjectResult { StatusCode: 403 };
}
Check(await PasswordRequestDenied(true, "https"), "public HTTPS cloud password login is blocked on the server");
Check(!await PasswordRequestDenied(false, "https"), "local installations retain normal password login");
Check(!await PasswordRequestDenied(true, "http"), "private SSH-tunnel recovery is retained without enabling public password login");
Check(TransactionTags.Normalize(new string?[] { null, " ", " FOOD ", "food", "travel,,Travel" }, lowercase: true) == "food,travel",
    "manual tags normalize nulls, whitespace, separators and case-insensitive duplicates");
Check(TransactionTags.Normalize(new string?[] { null, " , " }) == null, "empty manual tags clear the saved value");
Check(TransactionTags.Merge("Food,travel", "food, Travel, Bills") == "Food,travel,Bills",
    "rule tags preserve first spelling and order without duplicates");
var priorCulture = System.Globalization.CultureInfo.CurrentCulture;
try {
    System.Globalization.CultureInfo.CurrentCulture = new System.Globalization.CultureInfo("tr-TR");
    Check(TransactionTags.Normalize(new[] { "INVESTMENT" }, lowercase: true) == "investment", "tag normalization is independent of server culture");
} finally { System.Globalization.CultureInfo.CurrentCulture = priorCulture; }
using (var ruleSession = DbHelper.GetSession()) using (var ruleTransaction = ruleSession.BeginTransaction()) {
    ruleSession.Save(new CategorizationRule { OwnerUserId = 101, Name = "Invalid regex", Priority = 1, Enabled = true, NarrationRegex = "[", SetCategory = "Invalid" });
    ruleSession.Save(new CategorizationRule { OwnerUserId = 101, Name = "Wrong amount", Priority = 2, Enabled = true, MinAmount = 1000, SetCategory = "Wrong amount" });
    ruleSession.Save(new CategorizationRule { OwnerUserId = 101, Name = "Wrong mode", Priority = 3, Enabled = true, ModeEquals = "NEFT", SetCategory = "Wrong mode" });
    ruleSession.Save(new CategorizationRule { OwnerUserId = 101, Name = "Wrong bank", Priority = 4, Enabled = true, BankEquals = "IOB", SetCategory = "Wrong bank" });
    ruleSession.Save(new CategorizationRule { OwnerUserId = 101, Name = "Matching rule", Priority = 5, Enabled = true, NarrationContains = "coffee", NarrationRegex = "c[o]+ffee", ModeEquals = "upi", BankEquals = "hdfc", MinAmount = 10, MaxAmount = 100, SetCategory = "Dining", SetTags = "Food, food, Coffee" });
    ruleSession.Save(new CategorizationRule { OwnerUserId = 101, Name = "Lower priority", Priority = 6, Enabled = true, SetCategory = "Wrong priority" });
    ruleSession.Flush();
    var ruleInput = new BankTransaction { Description = "COFFEE shop", Mode = "UPI", BankType = "HDFC", Debit = 50, Tags = "Food" };
    var noNarration = new BankTransaction { Debit = 50 };
    new RuleEngineService().ApplyRules(ruleSession, 101, new[] { ruleInput, noNarration });
    Check(ruleInput.CategoryOverride == "Dining" && ruleInput.Tags == "Food,Coffee",
        "rules preserve priority, case-insensitive matching and amount/mode/bank conditions while ignoring invalid regex");
    Check(noNarration.CategoryOverride == "Wrong priority", "rules without narration conditions still apply to transactions without text");
    ruleTransaction.Rollback();
}
Console.WriteLine($"Passed {checks} import reliability checks ({(postgres == null ? "SQLite" : "PostgreSQL")}). Synthetic artifacts: {scratch}");

sealed class RegressionEnvironment : Microsoft.AspNetCore.Hosting.IWebHostEnvironment
{
    public string EnvironmentName { get; set; } = "Production";
    public string ApplicationName { get; set; } = "Synthetic tests";
    public string WebRootPath { get; set; } = "";
    public string ContentRootPath { get; set; } = "";
    public Microsoft.Extensions.FileProviders.IFileProvider WebRootFileProvider { get; set; } = new Microsoft.Extensions.FileProviders.NullFileProvider();
    public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = new Microsoft.Extensions.FileProviders.NullFileProvider();
}
