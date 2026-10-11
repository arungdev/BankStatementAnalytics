using System.Text;
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
Console.WriteLine($"Passed {checks} import reliability checks ({(postgres == null ? "SQLite" : "PostgreSQL")}). Synthetic artifacts: {scratch}");
