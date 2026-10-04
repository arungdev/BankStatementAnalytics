using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using BankStatementAnalytics.Models;
using Common.Framework.Auth;
using Common.Framework.Data;
using NHibernate.Linq;

namespace BankStatementAnalytics.Services
{
    public partial class GPayTakeoutService
    {
        private static readonly Regex CurrencyCleanRegex = new(@"[^\d.-]", RegexOptions.Compiled);
        private static readonly Regex TokenSplitRegex = new(@"[_\s\-\.\d]+", RegexOptions.Compiled);

        public static string GetConfigFilePath()
        {
            var dataDir = Path.Combine(Common.Framework.AppPaths.ResolveWritableAppDataDirectory(), "Data");
            if (!Directory.Exists(dataDir)) Directory.CreateDirectory(dataDir);
            return Path.Combine(dataDir, "gpay-auto-import.json");
        }

        public static async Task<HashSet<string>> GetConfiguredUserNamesAsync(long userId)
        {
            using var session = DbHelper.GetSession();
            return await GPayEvidenceService.OwnerNames(session, userId);
        }

        public async Task<GPayAutoImportConfigDto> GetAutoImportConfigAsync(long userId, string? profileId = null)
        {
            var filePath = GetConfigFilePath();
            GPayAutoImportConfigDto config;
            if (File.Exists(filePath))
            {
                try
                {
                    var json = await File.ReadAllTextAsync(filePath);
                    config = JsonSerializer.Deserialize<GPayAutoImportConfigDto>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                             ?? new GPayAutoImportConfigDto();
                }
                catch
                {
                    config = new GPayAutoImportConfigDto();
                }
            }
            else
            {
                const string defaultDir = @"D:\BankStatements\Gpay";
                config = new GPayAutoImportConfigDto
                {
                    WatchFolderPath = defaultDir,
                    WatchEnabled = Directory.Exists(defaultDir),
                    UserName = "ARUN G"
                };
            }

            if (string.IsNullOrWhiteSpace(config.UserName))
            {
                config.UserName = "ARUN G";
            }

            if (!string.IsNullOrWhiteSpace(profileId) && profileId != "default") config = await GetProfileAsync(userId, profileId);

            // Populate current stats from database
            using var session = DbHelper.GetSession();
            var billGroups = await session.Query<BillGroup>().Where(b => b.OwnerUserId == userId && b.GPayProfileId == config.ProfileId).ToListAsync();
            var splits = await session.Query<SplitGroup>().Where(s => s.OwnerUserId == userId && s.GPayProfileId == config.ProfileId).ToListAsync();
            var matchedCount = splits.Count(s => s.ParentBankReference != null) +
                               await session.Query<SplitGroupMember>().CountAsync(m => m.OwnerUserId == userId && m.Group.GPayProfileId == config.ProfileId && m.LinkedBankReference != null);

            var userAccountIds = await session.Query<Account>()
                .Where(a => a.OwnerUserId == userId)
                .Select(a => a.Id)
                .ToListAsync();

            int upiEnriched = 0;
            if (userAccountIds.Count > 0 && config.ProfileId == null)
            {
                upiEnriched = await session.Query<BankTransaction>()
                    .CountAsync(t => userAccountIds.Contains(t.AccountId) && t.Note != null && t.Note.Contains("GPay:"));
            }

            config.TotalGroups = billGroups.Count;
            config.TotalSplits = splits.Count;
            config.TotalVolume = splits.Sum(s => s.TotalAmount);
            config.BankMatches = matchedCount;
            if (upiEnriched > 0 || config.UpiActivitiesEnriched == 0)
            {
                config.UpiActivitiesEnriched = upiEnriched;
            }

            var candidates = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var accounts = await session.Query<Account>().Where(a => a.OwnerUserId == userId).ToListAsync();
            foreach (var a in accounts)
            {
                if (!string.IsNullOrWhiteSpace(a.AccountHolderName))
                    candidates.Add(a.AccountHolderName.Trim());
            }

            if (config.ProfileId == null) candidates.Add("ARUN G");
            config.CandidateUserNames = candidates.OrderBy(c => c).ToList();
            config.Profiles = await ListProfilesAsync(userId);

            return config;
        }

        public async Task<GPayAutoImportConfigDto> UpdateAutoImportConfigAsync(long userId, UpdateGPayAutoImportRequest request, string? profileId = null)
        {
            var config = await GetAutoImportConfigAsync(userId, profileId);
            if (request.WatchFolderPath != null)
            {
                var cleanPath = request.WatchFolderPath.Trim().Trim('"').Trim();
                config.WatchFolderPath = string.IsNullOrEmpty(cleanPath) ? null : cleanPath;
            }
            if (request.WatchEnabled.HasValue)
            {
                config.WatchEnabled = request.WatchEnabled.Value;
            }
            if (request.UserName != null)
            {
                var cleanName = request.UserName.Trim();
                config.UserName = string.IsNullOrEmpty(cleanName) ? null : cleanName;
            }

            if (request.BankAccountIds != null) config.BankAccountIds = request.BankAccountIds.Distinct().ToList();
            await ValidateProfileConfigAsync(userId, config);
            await SaveProfileConfigAsync(userId, config);

            return await GetAutoImportConfigAsync(userId, profileId);
        }

        public async Task<GPayTakeoutImportResultDto> SweepAsync(long userId, string? profileId = null)
        {
            var config = await GetAutoImportConfigAsync(userId, profileId);
            if (string.IsNullOrWhiteSpace(config.WatchFolderPath) || !Directory.Exists(config.WatchFolderPath))
            {
                return new GPayTakeoutImportResultDto
                {
                    Success = false,
                    Message = $"Watch folder not configured or not accessible: '{config.WatchFolderPath}'"
                };
            }

            var files = Directory.EnumerateFiles(config.WatchFolderPath, "*.*", SearchOption.TopDirectoryOnly)
                .Where(f => f.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) || f.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
                .Select(f => new FileInfo(f))
                .OrderByDescending(f => f.LastWriteTimeUtc)
                .ToList();

            if (files.Count == 0)
            {
                return new GPayTakeoutImportResultDto
                {
                    Success = false,
                    Message = $"No .zip archives or .json files found in '{config.WatchFolderPath}'."
                };
            }

            var latestFile = files[0];
            var result = await ImportFromPathAsync(userId, latestFile.FullName, profileId: config.ProfileId);

            config.LastSyncUtc = DateTime.UtcNow;
            config.LastResult = result.Success ? result.Message : $"Failed: {result.Message}";
            if (result.CashbackTotalEarned > 0) config.CashbackTotalEarned = result.CashbackTotalEarned;
            if (result.UpiActivitiesEnriched > 0) config.UpiActivitiesEnriched = result.UpiActivitiesEnriched;
            if (result.ActiveVouchersCount > 0) config.ActiveVouchersCount = result.ActiveVouchersCount;

            await SaveProfileConfigAsync(userId, config);

            return result;
        }

        public async Task SweepBackgroundAsync(CancellationToken stoppingToken)
        {
            await SweepAdditionalProfilesAsync(stoppingToken);
            var filePath = GetConfigFilePath();
            if (!File.Exists(filePath)) return;

            GPayAutoImportConfigDto? config;
            try
            {
                var json = await File.ReadAllTextAsync(filePath, stoppingToken);
                config = JsonSerializer.Deserialize<GPayAutoImportConfigDto>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            }
            catch { return; }

            if (config == null || !config.WatchEnabled || string.IsNullOrWhiteSpace(config.WatchFolderPath) || !Directory.Exists(config.WatchFolderPath))
                return;

            var candidates = Directory.EnumerateFiles(config.WatchFolderPath, "*.*", SearchOption.TopDirectoryOnly)
                .Where(f => f.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) || f.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
                .Select(f => new FileInfo(f))
                .OrderByDescending(f => f.LastWriteTimeUtc)
                .ToList();

            if (candidates.Count == 0) return;

            var latest = candidates[0];
            if (config.LastSyncUtc.HasValue && latest.LastWriteTimeUtc <= config.LastSyncUtc.Value)
            {
                return;
            }

            using var session = DbHelper.GetSession();
            var user = await session.Query<AppUser>().OrderBy(u => u.Id).FirstOrDefaultAsync(stoppingToken);
            if (user != null)
            {
                await SweepAsync(user.Id);
            }
        }

        public async Task<GPayTakeoutImportResultDto> ImportFromPathAsync(long userId, string filePath, string? expectedArchiveHash = null, string? profileId = null)
        {
            if (string.IsNullOrWhiteSpace(filePath) || !File.Exists(filePath))
            {
                return new GPayTakeoutImportResultDto
                {
                    Success = false,
                    Message = $"File not found at specified path: '{filePath}'"
                };
            }

            if (new FileInfo(filePath).Length > 250_000_000) throw new ArgumentException("Takeout file exceeds 250 MB.");
            await using var stream = File.OpenRead(filePath);
            return await ImportFromStreamAsync(userId, stream, Path.GetFileName(filePath), expectedArchiveHash, profileId);
        }

        public async Task<GPayTakeoutImportResultDto> ImportFromStreamAsync(long userId, Stream stream, string fileName, string? expectedArchiveHash = null, string? profileId = null)
        {
            using var buffer = new MemoryStream();
            await stream.CopyToAsync(buffer);
            var bundle = GPayEvidenceService.Scan(buffer.ToArray(), fileName);
            if (!string.IsNullOrWhiteSpace(profileId) && profileId != "default") { _ = await GetProfileAsync(userId, profileId); bundle.ProfileId = profileId; }
            if (expectedArchiveHash != null && !string.Equals(expectedArchiveHash, bundle.ArchiveHash, StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("Archive changed since preview. Preview it again before importing.");
            string? Find(string suffix) => bundle.Files.FirstOrDefault(f => f.Path.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))?.Content;
            var result = await ProcessImportDataAsync(userId, JsonSerializer.Serialize(new GPayTakeoutData { GroupExpenses = bundle.Expenses }),
                Find("Cashback rewards.csv"), bundle.Files.FirstOrDefault(f => f.Path.Contains("Google transactions/transactions_", StringComparison.OrdinalIgnoreCase))?.Content,
                Find("My Activity.html"), Find("Voucher rewards.json"), bundle);
            if (result.Success) {
                try {
                    var matches = await new GPayEvidenceService().AutoMatchActivities(userId);
                    result.UpiActivitiesEnriched = matches.Linked;
                    if (matches.Linked > 0) result.Message += $" Automatically linked {matches.Linked} GPay payments to bank transactions.";
                } catch (Exception exception) {
                    // The source import has committed. Keep it successful and retry matching on the activity page.
                    result.Message += " Source import completed; automatic bank matching will retry when GPay Activity opens.";
                    Common.Framework.Logging.Log.Warn("Automatic GPay matching after import failed: " + exception.Message);
                }
            }
            return result;
        }

        private async Task<GPayTakeoutImportResultDto> ProcessImportDataAsync(
            long userId,
            string? groupExpensesJson,
            string? cashbackCsv,
            string? transactionsCsv,
            string? activityHtml,
            string? voucherJson, GPayBundle bundle)
        {
            GPayTakeoutData? takeoutData = null;
            if (!string.IsNullOrWhiteSpace(groupExpensesJson))
            {
                try
                {
                    takeoutData = JsonSerializer.Deserialize<GPayTakeoutData>(groupExpensesJson, new JsonSerializerOptions
                    {
                        PropertyNameCaseInsensitive = true
                    });
                }
                catch (Exception ex)
                {
                    if (string.IsNullOrWhiteSpace(activityHtml))
                    {
                        return new GPayTakeoutImportResultDto
                        {
                            Success = false,
                            Message = $"Failed to parse Google Pay JSON data: {ex.Message}"
                        };
                    }
                }
            }

            using var session = DbHelper.GetSession();

            // 1. Identify the user's identity / name
            var ownedAccounts = await session.Query<Account>()
                .Where(a => a.OwnerUserId == userId)
                .ToListAsync();

            var profile = bundle.ProfileId == null ? null : await GetProfileAsync(userId, bundle.ProfileId);
            var userNames = profile == null ? await GPayEvidenceService.OwnerNames(session, userId) : new HashSet<string> { GPayEvidenceService.Normalize(profile.UserName) };

            // 3. Pre-fetch existing BillGroups and SplitGroups to prevent duplicates
            var existingBillGroups = await session.Query<BillGroup>()
                .Where(b => b.OwnerUserId == userId && b.GPayProfileId == bundle.ProfileId)
                .ToListAsync();

            var billGroupMap = new Dictionary<string, BillGroup>(StringComparer.OrdinalIgnoreCase);
            foreach (var bg in existingBillGroups)
            {
                billGroupMap[bg.Name.Trim()] = bg;
            }

            var existingSplits = await session.Query<SplitGroup>()
                .Where(s => s.OwnerUserId == userId && s.GPayProfileId == bundle.ProfileId)
                .ToListAsync();

            int groupsCreated = 0;
            int splitsImported = 0;
            int membersImported = 0;
            int txMatched = 0;
            decimal totalVolume = 0m;

            var groupSummaryList = new List<GPayGroupImportSummaryDto>();

            using var tx = session.BeginTransaction();

            try
            {
                // ── A. PROCESS GROUP EXPENSES IF PRESENT ──────────────────────────
                if (takeoutData?.GroupExpenses != null && takeoutData.GroupExpenses.Count > 0)
                {
                    var expensesByGroup = takeoutData.GroupExpenses
                        .GroupBy(e => string.IsNullOrWhiteSpace(e.GroupName) ? "General Split" : e.GroupName.Trim())
                        .ToList();

                    foreach (var groupCluster in expensesByGroup)
                    {
                        var groupName = groupCluster.Key;
                        var expensesInGroup = groupCluster.ToList();

                        // Find or create BillGroup
                        if (!billGroupMap.TryGetValue(groupName, out var billGroup))
                        {
                            var earliestDate = DateTime.Now;
                            foreach (var e in expensesInGroup)
                            {
                                if (DateTime.TryParse(e.CreationTime, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal, out var d) && d < earliestDate)
                                {
                                    earliestDate = d.ToLocalTime();
                                }
                            }

                            billGroup = new BillGroup
                            {
                                OwnerUserId = userId,
                                GPayProfileId = bundle.ProfileId,
                                Name = groupName,
                                Description = $"Google Pay Group ({expensesInGroup.Count} expenses)",
                                CreatedOn = earliestDate,
                                UpdatedOn = DateTime.Now,
                                Members = new List<BillGroupMember>()
                            };

                            await session.SaveAsync(billGroup);
                            billGroupMap[groupName] = billGroup;
                            groupsCreated++;
                        }

                        // Collect distinct participant names
                        var existingMemberNames = billGroup.Members.Select(m => m.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
                        var allParticipantsInGroup = expensesInGroup
                            .SelectMany(e => (e.Items ?? new()).Select(i => i.Payer?.Trim()).Append(e.Creator?.Trim()))
                            .Where(p => !string.IsNullOrWhiteSpace(p) && !IsUser(p, userNames))
                            .Distinct(StringComparer.OrdinalIgnoreCase)
                            .ToList();

                        foreach (var pName in allParticipantsInGroup)
                        {
                            if (pName != null && !existingMemberNames.Contains(pName))
                            {
                                var newBgMember = new BillGroupMember
                                {
                                    OwnerUserId = userId,
                                    Group = billGroup,
                                    Name = pName,
                                    CreatedOn = DateTime.Now
                                };
                                await session.SaveAsync(newBgMember);
                                billGroup.Members.Add(newBgMember);
                                existingMemberNames.Add(pName);
                            }
                        }

                        int groupSplitsAdded = 0;
                        decimal groupTotalVolume = 0m;

                        // Process each expense in this group
                        foreach (var exp in expensesInGroup)
                        {
                            var totalAmount = ParseCurrency(exp.TotalAmount);
                            totalVolume += totalAmount;
                            groupTotalVolume += totalAmount;

                            var creationDate = GPayEvidenceService.LocalDate(exp.CreationTime);
                            var splitTitle = !string.IsNullOrWhiteSpace(exp.Title)
                                ? exp.Title.Trim()
                                : $"{groupName} Expense";

                            // Check duplicate
                            if (GPayEvidenceService.Corresponding(existingSplits, exp, bundle.ProfileId).Count > 0)
                            {
                                continue;
                            }

                            var isUserCreator = IsUser(exp.Creator, userNames);
                            var rawItems = exp.Items ?? new List<GPayExpenseMemberItem>();

                            // User's own share
                            var userItem = rawItems.FirstOrDefault(i => IsUser(i.Payer, userNames));
                            decimal userShareAmount = 0m;
                            if (userItem != null)
                            {
                                userShareAmount = ParseCurrency(userItem.Amount);
                            }
                            else if (isUserCreator)
                            {
                                var othersTotal = rawItems.Sum(i => ParseCurrency(i.Amount));
                                userShareAmount = Math.Max(0m, totalAmount - othersTotal);
                            }

                            var splitGroup = new SplitGroup
                            {
                                OwnerUserId = userId,
                                GroupUid = Guid.NewGuid(),
                                BillGroupId = billGroup.Id,
                                GroupName = billGroup.Name,
                                Title = splitTitle,
                                Description = $"Google Pay expense created by {exp.Creator ?? "Participant"}",
                                SourceKey = GPayEvidenceService.ProfileExpenseKey(exp, bundle.ProfileId),
                                GPayProfileId = bundle.ProfileId,
                                GPayOwnerName = profile?.UserName,
                                SourceState = exp.State,
                                CreatorName = exp.Creator,
                                SourceSnapshot = JsonSerializer.Serialize(exp),
                                SourceImportedUtc = DateTime.UtcNow,
                                Date = creationDate,
                                TotalAmount = totalAmount,
                                UserShareAmount = userShareAmount,
                                Confidence = "Confirmed",
                                SplitType = "GPaySplit",
                                Status = "Active",
                                CreatedOn = DateTime.Now,
                                Members = new List<SplitGroupMember>()
                            };

                            await session.SaveAsync(splitGroup);

                            decimal totalSettled = 0m;

                            foreach (var item in rawItems)
                            {
                                var itemAmount = ParseCurrency(item.Amount);
                                var isItemUser = IsUser(item.Payer, userNames);
                                var isSettled = GPayEvidenceService.IsPaid(item.State);

                                var paidAmount = isSettled ? itemAmount : 0m;

                                var member = new SplitGroupMember
                                {
                                    OwnerUserId = userId,
                                    Group = splitGroup,
                                    ParticipantName = string.IsNullOrWhiteSpace(item.Payer) ? "Participant" : item.Payer.Trim(),
                                    AssignedAmount = itemAmount,
                                    PaidAmount = paidAmount,
                                    IsSettled = isSettled,
                                    IsUser = isItemUser,
                                    SourceState = item.State,
                                    SettlementEvidence = GPayEvidenceService.Evidence(item.State),
                                    Notes = string.IsNullOrWhiteSpace(item.Note) ? null : item.Note.Trim(),
                                    CreatedOn = DateTime.Now
                                };

                                await session.SaveAsync(member);
                                splitGroup.Members.Add(member);
                                membersImported++;

                                if (isSettled && !isItemUser)
                                {
                                    totalSettled += paidAmount;
                                }
                            }

                            GPayEvidenceService.Recalculate(splitGroup, userNames);

                            await session.UpdateAsync(splitGroup);
                            existingSplits.Add(splitGroup);

                            splitsImported++;
                            groupSplitsAdded++;
                        }

                        groupSummaryList.Add(new GPayGroupImportSummaryDto
                        {
                            GroupName = groupName,
                            ExpenseCount = expensesInGroup.Count,
                            NewSplitsImported = groupSplitsAdded,
                            TotalAmount = groupTotalVolume,
                            MemberCount = billGroup.Members.Count
                        });
                    }
                }

                // Source evidence is retained; bank enrichment needs explicit review.
                int upiEnrichedCount = 0, cashbackMatchedCount = 0, subscriptionsMatchedCount = 0;
                var cashbackItems = string.IsNullOrWhiteSpace(cashbackCsv) ? new List<GPayCashbackItem>() : GPayActivityParser.ParseCashbackCsv(cashbackCsv);
                int cashbackCount = cashbackItems.Count;
                decimal cashbackTotal = cashbackItems.Sum(c => c.Amount);

                // ── E. PARSE VOUCHERS & COUPONS ──────────────────────────────────
                int activeVouchersCount = 0;
                if (!string.IsNullOrWhiteSpace(voucherJson))
                {
                    var vouchers = GPayActivityParser.ParseVouchersJson(voucherJson);
                    activeVouchersCount = vouchers.Count(v => v.IsActive);
                }

                await GPayEvidenceService.StoreBundle(session, userId, bundle);
                await tx.CommitAsync();

                var messageParts = new List<string>();
                if (splitsImported > 0 || groupsCreated > 0)
                {
                    messageParts.Add($"Imported {splitsImported} expenses across {groupSummaryList.Count} groups");
                }
                if (txMatched > 0)
                {
                    messageParts.Add($"matched {txMatched} split bank transactions");
                }
                if (upiEnrichedCount > 0)
                {
                    messageParts.Add($"enriched {upiEnrichedCount} UPI transactions with clean merchant names");
                }
                if (cashbackMatchedCount > 0)
                {
                    messageParts.Add($"reconciled {cashbackMatchedCount} cashback rewards (₹{cashbackTotal:N2} total)");
                }
                if (subscriptionsMatchedCount > 0)
                {
                    messageParts.Add($"categorized {subscriptionsMatchedCount} digital subscriptions");
                }
                if (activeVouchersCount > 0)
                {
                    messageParts.Add($"{activeVouchersCount} unexpired vouchers found");
                }

                var finalMessage = messageParts.Count > 0
                    ? string.Join(", ", messageParts) + "."
                    : "Google Pay data synchronized successfully.";

                return new GPayTakeoutImportResultDto
                {
                    Success = true,
                    Message = finalMessage,
                    GroupsImported = groupSummaryList.Count,
                    SplitsImported = splitsImported,
                    MembersImported = membersImported,
                    TransactionsMatched = txMatched,
                    TotalVolumeProcessed = totalVolume,
                    CashbackRewardsCount = cashbackCount,
                    CashbackTotalEarned = cashbackTotal,
                    UpiActivitiesEnriched = upiEnrichedCount,
                    CashbackTransactionsMatched = cashbackMatchedCount,
                    SubscriptionsMatched = subscriptionsMatchedCount,
                    ActiveVouchersCount = activeVouchersCount,
                    Groups = groupSummaryList.OrderByDescending(g => g.ExpenseCount).ToList()
                };
            }
            catch (Exception)
            {
                await tx.RollbackAsync();
                throw;
            }
        }

        private static string ResolveOrderMerchant(string desc)
        {
            if (desc.Contains("Claude", StringComparison.OrdinalIgnoreCase)) return "Anthropic (Claude Pro)";
            if (desc.Contains("YouTube", StringComparison.OrdinalIgnoreCase)) return "YouTube Premium";
            if (desc.Contains("LinkedIn", StringComparison.OrdinalIgnoreCase)) return "LinkedIn";
            if (desc.Contains("Minecraft", StringComparison.OrdinalIgnoreCase)) return "Mojang / Minecraft";
            return "Google Play";
        }

        private static (string Category, string SubCategory)? InferCategory(string name)
        {
            if (string.IsNullOrWhiteSpace(name)) return null;
            var lower = name.ToLowerInvariant();

            if (lower.Contains("swiggy") || lower.Contains("zomato") || lower.Contains("hotel") ||
                lower.Contains("restaurant") || lower.Contains("bakery") || lower.Contains("tiffin") ||
                lower.Contains("dosa") || lower.Contains("cafe") || lower.Contains("tea") ||
                lower.Contains("coffee") || lower.Contains("food") || lower.Contains("eats"))
            {
                return ("Food & Dining", "Restaurants");
            }

            if (lower.Contains("cumta") || lower.Contains("transport") || lower.Contains("irctc") ||
                lower.Contains("train") || lower.Contains("railway") || lower.Contains("bus") ||
                lower.Contains("redbus") || lower.Contains("metro") || lower.Contains("uber") ||
                lower.Contains("ola") || lower.Contains("rapido") || lower.Contains("petrol") ||
                lower.Contains("fuel") || lower.Contains("petroleum"))
            {
                return ("Transportation", "Commute & Travel");
            }

            if (lower.Contains("electricity") || lower.Contains("tnpdcl") || lower.Contains("power") ||
                lower.Contains("board") || lower.Contains("gas") || lower.Contains("jio") ||
                lower.Contains("airtel") || lower.Contains("vodafone") || lower.Contains("broadband") ||
                lower.Contains("recharge") || lower.Contains("bill"))
            {
                return ("Utilities & Bills", "Mobile & Services");
            }

            if (lower.Contains("supermarket") || lower.Contains("super market") || lower.Contains("store") ||
                lower.Contains("stores") || lower.Contains("dairy") || lower.Contains("fresh") ||
                lower.Contains("grocery") || lower.Contains("provisions"))
            {
                return ("Groceries", "Supermarket");
            }

            if (lower.Contains("amazon") || lower.Contains("flipkart") || lower.Contains("myntra") ||
                lower.Contains("meesho") || lower.Contains("nykaa"))
            {
                return ("Shopping", "Online Shopping");
            }

            if (lower.Contains("spotify") || lower.Contains("netflix") || lower.Contains("hotstar") ||
                lower.Contains("youtube") || lower.Contains("prime"))
            {
                return ("Entertainment & Media", "Streaming");
            }

            if (lower.Contains("pharmacy") || lower.Contains("medical") || lower.Contains("hospital") ||
                lower.Contains("clinic") || lower.Contains("apollo") || lower.Contains("medplus"))
            {
                return ("Healthcare", "Medical");
            }

            return null;
        }

        private static bool IsUser(string? name, HashSet<string> userNames)
        {
            if (string.IsNullOrWhiteSpace(name)) return false;
            var clean = name.Trim();
            var normalized = Regex.Replace(clean, @"\s+", " ");
            return userNames.Any(n => string.Equals(Regex.Replace(n.Trim(), @"\s+", " "),
                normalized, StringComparison.OrdinalIgnoreCase));
        }

        private static decimal ParseCurrency(string? raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return 0m;
            var cleaned = CurrencyCleanRegex.Replace(raw, "");
            return decimal.TryParse(cleaned, NumberStyles.Any, CultureInfo.InvariantCulture, out var val) ? val : 0m;
        }


    }

    public class GPayExpenseItem
    {
        [JsonPropertyName("creation_time")]
        public string? CreationTime { get; set; }

        [JsonPropertyName("creator")]
        public string? Creator { get; set; }

        [JsonPropertyName("group_name")]
        public string? GroupName { get; set; }

        [JsonPropertyName("total_amount")]
        public string? TotalAmount { get; set; }

        [JsonPropertyName("state")]
        public string? State { get; set; }

        [JsonPropertyName("title")]
        public string? Title { get; set; }

        [JsonPropertyName("items")]
        public List<GPayExpenseMemberItem>? Items { get; set; }
    }

    public class GPayExpenseMemberItem
    {
        [JsonPropertyName("amount")]
        public string? Amount { get; set; }

        [JsonPropertyName("state")]
        public string? State { get; set; }

        [JsonPropertyName("payer")]
        public string? Payer { get; set; }

        [JsonPropertyName("note")]
        public string? Note { get; set; }
    }

    public class GPayTakeoutData
    {
        [JsonPropertyName("Group_expenses")]
        public List<GPayExpenseItem>? GroupExpenses { get; set; }
    }

    public class GPayTakeoutImportResultDto
    {
        public bool Success { get; set; }
        public string Message { get; set; } = string.Empty;
        public int GroupsImported { get; set; }
        public int SplitsImported { get; set; }
        public int MembersImported { get; set; }
        public int TransactionsMatched { get; set; }
        public decimal TotalVolumeProcessed { get; set; }
        public int CashbackRewardsCount { get; set; }
        public decimal CashbackTotalEarned { get; set; }
        public int UpiActivitiesEnriched { get; set; }
        public int CashbackTransactionsMatched { get; set; }
        public int SubscriptionsMatched { get; set; }
        public int ActiveVouchersCount { get; set; }
        public List<GPayGroupImportSummaryDto> Groups { get; set; } = new();
    }

    public class GPayGroupImportSummaryDto
    {
        public string GroupName { get; set; } = string.Empty;
        public int ExpenseCount { get; set; }
        public int NewSplitsImported { get; set; }
        public decimal TotalAmount { get; set; }
        public int MemberCount { get; set; }
    }

    public class GPayAutoImportConfigDto
    {
        public string? ProfileId { get; set; }
        public string ProfileName { get; set; } = "Primary GPay";
        public List<long> BankAccountIds { get; set; } = new();
        public List<GPayProfileSummary> Profiles { get; set; } = new();
        public string? WatchFolderPath { get; set; }
        public bool WatchEnabled { get; set; }
        public string? UserName { get; set; }
        public List<string> CandidateUserNames { get; set; } = new();
        public DateTime? LastSyncUtc { get; set; }
        public string? LastResult { get; set; }
        public int TotalGroups { get; set; }
        public int TotalSplits { get; set; }
        public decimal TotalVolume { get; set; }
        public int BankMatches { get; set; }
        public int UpiActivitiesEnriched { get; set; }
        public decimal CashbackTotalEarned { get; set; }
        public int ActiveVouchersCount { get; set; }
    }

    public class UpdateGPayAutoImportRequest
    {
        public string? WatchFolderPath { get; set; }
        public bool? WatchEnabled { get; set; }
        public string? UserName { get; set; }
        public List<long>? BankAccountIds { get; set; }
    }
}
