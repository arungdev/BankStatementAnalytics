using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using BankStatementAnalytics.Models;
using Common.Framework.Data;
using NHibernate.Linq;

namespace BankStatementAnalytics.Services
{
    public partial class GPaySplitService
    {
        private const int LookbackMonths = 12;
        private const int MaxDaysApart = 1;
        private const int MinCreditLegs = 2;
        private const decimal AmountTolerance = 1.00m;

        // VPA patterns for Google Pay PSP banks
        private static readonly Regex GPayVpaRegex = new(
            @"@ok(axis|sbi|hdfcbank|icici|google)\b",
            RegexOptions.Compiled | RegexOptions.IgnoreCase);

        // Keywords in narrations suggesting GPay / Split / Group
        private static readonly Regex GPayNarrationRegex = new(
            @"\b(GOOGLE\s*PAY|GOOGLEPAY|GPAY)\b",
            RegexOptions.Compiled | RegexOptions.IgnoreCase);

        private static readonly Regex SplitKeywordRegex = new(
            @"\b(SPLIT|SHARE|BILL|CONTRIB|CONTRIBUTION|DINNER|LUNCH|FOOD|PARTY|TRIP|ROOM|RENT)\b",
            RegexOptions.Compiled | RegexOptions.IgnoreCase);

        private static readonly Regex OtherAppVpaRegex = new(
            @"@(ybl|axl|ibl|paytm|apl|upi)\b",
            RegexOptions.Compiled | RegexOptions.IgnoreCase);

        // ────────────────────────────────────────────────────────────────────
        // AUTO DETECTION
        // ────────────────────────────────────────────────────────────────────

        /// <summary>
        /// Detects clusters of UPI transactions that appear to be GPay Split or Group payments.
        /// </summary>
        public List<GPaySplitSuggestionDto> DetectCandidates(long userId)
        {
            using var session = DbHelper.GetSession();

            var accountIds = AccountAccess.OwnedIds(session, userId);
            if (accountIds.Count == 0) return new List<GPaySplitSuggestionDto>();

            var from = DateTime.Today.AddMonths(-LookbackMonths);

            // Fetch already linked transaction references in existing SplitGroups to avoid re-suggesting
            var linkedMembers = session.Query<SplitGroupMember>().Where(m => m.OwnerUserId == userId && m.LinkedBankReference != null).ToList();
            var linkedParents = session.Query<SplitGroup>().Where(g => g.OwnerUserId == userId && g.ParentBankReference != null).ToList();
            var alreadyLinkedRefs = linkedMembers.Select(m => GPayEvidenceService.TxKey(m.LinkedAccountId ?? 0,m.LinkedBankReference!,m.LinkedBankType ?? "",m.LinkedTransactionType ?? "")).Concat(linkedParents.Select(g => GPayEvidenceService.TxKey(g.ParentAccountId ?? 0,g.ParentBankReference!,g.ParentBankType ?? "",g.ParentTransactionType ?? ""))).Concat(session.Query<GPaySettlementAllocation>().Where(a=>a.OwnerUserId==userId).ToList().Select(a=>GPayEvidenceService.TxKey(a.AccountId,a.BankReference,a.BankType,a.TransactionType))).ToHashSet();

            // Load candidate UPI transactions
            var upiRows = session.Query<BankTransaction>()
                .Where(t => accountIds.Contains(t.AccountId)
                         && t.TransactionDate >= from
                         && t.Mode == "UPI"
                         && t.TransferGroupId == null) // exclude own-account transfers
                .Select(t => new RawUpiRow
                {
                    AccountId = t.AccountId,
                    BankReference = t.BankReference,
                    BankType = t.BankType,
                    TransactionType = t.TransactionType,
                    Date = t.TransactionDate,
                    Debit = t.Debit,
                    Credit = t.Credit,
                    Amount = t.Debit > 0 ? t.Debit : t.Credit,
                    Direction = t.Debit > 0 ? "Debit" : "Credit",
                    Narration = t.Narration ?? t.Description ?? string.Empty,
                    UpiReference = t.UpiReference ?? string.Empty,
                    UpiVpa = t.UpiVpa ?? string.Empty,
                    CounterPartyName = t.CounterParty != null
                        ? (t.CounterParty.FriendlyName ?? t.CounterParty.Name)
                        : string.Empty
                })
                .ToList();

            // Filter out already claimed transactions
            var availableRows = upiRows
                .Where(r => !alreadyLinkedRefs.Contains(GPayEvidenceService.TxKey(r.AccountId,r.BankReference,r.BankType,r.TransactionType)))
                .ToList();

            foreach (var row in availableRows)
            {
                AnnotateGPaySignals(row);
            }

            var candidates = new List<GPaySplitSuggestionDto>();

            // Strategy: Cluster incoming credits per account & date
            var creditsByAccountDate = availableRows
                .Where(r => r.Direction == "Credit")
                .GroupBy(r => (r.AccountId, r.Date.Date));

            var accounts = session.Query<Account>()
                .Where(a => a.OwnerUserId == userId)
                .ToList();

            var ownerNames = accounts
                .Select(a => (a.AccountHolderName ?? string.Empty).Trim().ToLowerInvariant())
                .Where(n => !string.IsNullOrWhiteSpace(n))
                .ToHashSet();

            foreach (var group in creditsByAccountDate)
            {
                var credits = group.ToList();
                if (credits.Count < MinCreditLegs) continue;

                var amountClusters = ClusterByAmount(credits, AmountTolerance);

                foreach (var cluster in amountClusters)
                {
                    if (cluster.Count < MinCreditLegs) continue;

                    var candidate = EvaluateCluster(cluster, availableRows, group.Key.AccountId, group.Key.Date, ownerNames);
                    if (candidate != null)
                    {
                        candidates.Add(candidate);
                    }
                }
            }

            return candidates
                .OrderByDescending(c => c.Date)
                .ThenByDescending(c => c.Confidence == "Medium" ? 2 : (c.Confidence == "Low" ? 1 : 0))
                .ToList();
        }

        private static void AnnotateGPaySignals(RawUpiRow row)
        {
            if (!string.IsNullOrWhiteSpace(row.UpiVpa) && GPayVpaRegex.IsMatch(row.UpiVpa))
            {
                row.IsGPay = true;
                row.GPayIndicators.Add($"GPay VPA handle: {row.UpiVpa}");
            }

            if (GPayNarrationRegex.IsMatch(row.Narration))
            {
                row.IsGPay = true;
                row.GPayIndicators.Add("Narration indicates Google Pay");
            }

            if (SplitKeywordRegex.IsMatch(row.Narration))
            {
                row.GPayIndicators.Add("Narration contains split/expense keyword");
            }

            if (!string.IsNullOrWhiteSpace(row.UpiVpa) && OtherAppVpaRegex.IsMatch(row.UpiVpa))
            {
                row.GPayIndicators.Add($"Non-GPay UPI handle: {row.UpiVpa}");
            }
        }

        private static List<List<RawUpiRow>> ClusterByAmount(List<RawUpiRow> rows, decimal tolerance)
        {
            var sorted = rows.OrderBy(r => r.Amount).ToList();
            var clusters = new List<List<RawUpiRow>>();
            if (sorted.Count == 0) return clusters;

            var current = new List<RawUpiRow> { sorted[0] };
            decimal anchor = sorted[0].Amount;

            for (int i = 1; i < sorted.Count; i++)
            {
                if (Math.Abs(sorted[i].Amount - anchor) <= tolerance)
                {
                    current.Add(sorted[i]);
                }
                else
                {
                    clusters.Add(current);
                    current = new List<RawUpiRow> { sorted[i] };
                    anchor = sorted[i].Amount;
                }
            }
            clusters.Add(current);
            return clusters;
        }

        private static GPaySplitSuggestionDto? EvaluateCluster(
            List<RawUpiRow> credits,
            List<RawUpiRow> allRows,
            long accountId,
            DateTime date,
            HashSet<string> ownerNames)
        {
            // Exclude self-credits where counterparty is the account owner themselves
            credits = credits.Where(r =>
            {
                var cpName = (r.CounterPartyName ?? string.Empty).Trim().ToLowerInvariant();
                if (!string.IsNullOrWhiteSpace(cpName) && ownerNames.Contains(cpName)) return false;
                return true;
            }).ToList();

            if (credits.Count < MinCreditLegs)
                return null;

            // Must have at least 2 distinct counterparty names (not just 2 VPAs of the same person)
            var distinctSenders = credits
                .Select(r => !string.IsNullOrWhiteSpace(r.CounterPartyName)
                    ? r.CounterPartyName.Trim().ToLowerInvariant()
                    : (r.UpiVpa?.Split('@')[0].ToLowerInvariant() ?? string.Empty))
                .Where(n => !string.IsNullOrWhiteSpace(n))
                .Distinct()
                .Count();

            if (distinctSenders < MinCreditLegs)
                return null;

            var distinctVpas = credits
                .Where(r => !string.IsNullOrWhiteSpace(r.UpiVpa))
                .Select(r => r.UpiVpa.ToLowerInvariant())
                .Distinct()
                .Count();

            int totalLegs = credits.Count;
            int gpayCount = credits.Count(r => r.IsGPay);
            decimal creditSum = credits.Sum(r => r.Amount);
            decimal avgAmount = credits.Average(r => r.Amount);

            // Find matching merchant/bill debit on same or adjacent day
            var matchingDebit = allRows
                .Where(r => r.AccountId == accountId
                         && r.Direction == "Debit"
                         && Math.Abs((r.Date.Date - date.Date).Days) <= MaxDaysApart
                         && r.Amount >= creditSum
                         && r.Amount <= creditSum * 2.5m)
                .OrderBy(r => Math.Abs(r.Amount - (creditSum + avgAmount)))
                .FirstOrDefault();

            var evalCtx = new SplitClusterEvaluationContext
            {
                CreditLegs = credits.Select(c => new RawUpiTransaction
                {
                    AccountId = c.AccountId,
                    BankReference = c.BankReference,
                    BankType = c.BankType,
                    TransactionType = c.TransactionType,
                    Date = c.Date,
                    Amount = c.Amount,
                    Direction = c.Direction,
                    Narration = c.Narration,
                    UpiVpa = c.UpiVpa,
                    CounterPartyName = c.CounterPartyName
                }).ToList(),
                ParentDebit = matchingDebit != null ? new RawUpiTransaction
                {
                    AccountId = matchingDebit.AccountId,
                    BankReference = matchingDebit.BankReference,
                    BankType = matchingDebit.BankType,
                    TransactionType = matchingDebit.TransactionType,
                    Date = matchingDebit.Date,
                    Amount = matchingDebit.Amount,
                    Direction = matchingDebit.Direction,
                    Narration = matchingDebit.Narration,
                    UpiVpa = matchingDebit.UpiVpa,
                    CounterPartyName = matchingDebit.CounterPartyName
                } : null,
                ClusterDate = date,
                OwnerNames = ownerNames
            };

            var evalResult = GPaySplitScoringEngine.Evaluate(evalCtx);
            if (evalResult.Score < 30 || evalResult.Classification == "Normal UPI Payment")
                return null;

            var suggestion = new GPaySplitSuggestionDto
            {
                Date = date,
                InferredTotalAmount = evalResult.InferredTotal,
                InferredUserShare = evalResult.InferredUserShare,
                CreditSum = creditSum,
                Score = evalResult.Score,
                Confidence = evalResult.Confidence,
                Classification = evalResult.Classification,
                Evidence = evalResult.PositiveSignals,
                ParentDebit = matchingDebit != null ? ToLegDto(matchingDebit) : null,
                CreditLegs = credits.Select(ToLegDto).ToList(),
                SuggestedMembers = credits.Select(c => new SuggestedMemberDto
                {
                    Name = !string.IsNullOrWhiteSpace(c.CounterPartyName) ? c.CounterPartyName : (c.UpiVpa ?? "Friend"),
                    Vpa = c.UpiVpa,
                    AssignedAmount = c.Amount,
                    BankReference = c.BankReference,
                    BankType = c.BankType,
                    AccountId = c.AccountId,
                    TransactionType = c.TransactionType
                }).ToList()
            };

            return suggestion;
        }

        private static SplitLegDto ToLegDto(RawUpiRow r) => new()
        {
            AccountId = r.AccountId,
            BankReference = r.BankReference,
            BankType = r.BankType,
            TransactionType = r.TransactionType,
            Date = r.Date,
            Amount = r.Amount,
            Direction = r.Direction,
            Narration = r.Narration,
            UpiReference = r.UpiReference,
            UpiVpa = r.UpiVpa,
            CounterPartyName = r.CounterPartyName,
            IsGPay = r.IsGPay,
            GPayIndicators = r.GPayIndicators
        };

        // ────────────────────────────────────────────────────────────────────
        // MANUAL SPLIT / GROUP MANAGEMENT
        // ────────────────────────────────────────────────────────────────────

        /// <summary>
        /// Retrieves all confirmed or created split groups for the user.
        /// </summary>
        public async Task<List<SplitGroupDetailDto>> GetGroupsAsync(long userId)
        {
            var userNames = await GPayTakeoutService.GetConfiguredUserNamesAsync(userId);

            using var session = DbHelper.GetSession();
            var groups = await session.Query<SplitGroup>()
                .Where(g => g.OwnerUserId == userId)
                .OrderByDescending(g => g.Date)
                .ToListAsync();

            return groups.Select(g => ToGroupDetailDto(g, userNames)).ToList();
        }

        /// <summary>
        /// Retrieves a single split group by Id.
        /// </summary>
        public async Task<SplitGroupDetailDto?> GetGroupByIdAsync(long userId, int groupId)
        {
            var userNames = await GPayTakeoutService.GetConfiguredUserNamesAsync(userId);

            using var session = DbHelper.GetSession();
            var group = await session.Query<SplitGroup>()
                .FirstOrDefaultAsync(g => g.Id == groupId && g.OwnerUserId == userId);

            return group != null ? ToGroupDetailDto(group, userNames) : null;
        }

        /// <summary>
        /// Creates a new SplitGroup, with manual or auto-assigned member shares.
        /// </summary>
        public async Task<SplitGroupDetailDto> CreateGroupAsync(long userId, CreateSplitGroupRequest req)
        {
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            string? groupName = req.GroupName;
            if (req.BillGroupId.HasValue && string.IsNullOrWhiteSpace(groupName))
            {
                var bg = await session.Query<BillGroup>().FirstOrDefaultAsync(b => b.Id == req.BillGroupId.Value && b.OwnerUserId == userId);
                if (bg == null) throw new ArgumentException("Owned group not found.");
                if (bg.Description?.StartsWith("Google Pay Group (") == true) throw new ArgumentException("Imported groups are source-managed. Choose a custom group.");
                groupName = bg.Name;
            }

            var group = new SplitGroup
            {
                OwnerUserId = userId,
                GroupUid = Guid.NewGuid(),
                BillGroupId = req.BillGroupId,
                GroupName = groupName?.Trim(),
                Title = string.IsNullOrWhiteSpace(req.Title) ? $"Split on {req.Date:dd MMM yyyy}" : req.Title.Trim(),
                Description = req.Description?.Trim(),
                Date = req.Date,
                TotalAmount = req.TotalAmount,
                UserShareAmount = req.UserShareAmount,
                Confidence = req.Confidence ?? "Confirmed",
                SplitType = req.SplitType ?? "GPaySplit",
                Status = "Active",
                ParentAccountId = req.ParentAccountId,
                ParentBankReference = req.ParentBankReference,
                ParentBankType = req.ParentBankType,
                ParentTransactionType = req.ParentTransactionType,
                CreatedOn = DateTime.Now
            };

            await session.SaveAsync(group);

            decimal totalSettled = 0m;

            if (req.Members != null && req.Members.Count > 0)
            {
                foreach (var m in req.Members)
                {
                    var isSettled = m.IsSettled || (m.PaidAmount >= m.AssignedAmount && m.AssignedAmount > 0);
                    var paid = m.PaidAmount > 0 ? m.PaidAmount : (isSettled ? m.AssignedAmount : 0m);

                    var member = new SplitGroupMember
                    {
                        OwnerUserId = userId,
                        Group = group,
                        ParticipantName = string.IsNullOrWhiteSpace(m.ParticipantName) ? "Participant" : m.ParticipantName.Trim(),
                        ParticipantVpa = m.ParticipantVpa?.Trim(),
                        AssignedAmount = m.AssignedAmount,
                        PaidAmount = paid,
                        IsSettled = isSettled,
                        IsUser = m.IsUser,
                        LinkedAccountId = m.LinkedAccountId,
                        LinkedBankReference = m.LinkedBankReference,
                        LinkedBankType = m.LinkedBankType,
                        LinkedTransactionType = m.LinkedTransactionType,
                        Notes = m.Notes?.Trim(),
                        CreatedOn = DateTime.Now
                    };

                    await session.SaveAsync(member);
                    group.Members.Add(member);

                    if (isSettled)
                    {
                        totalSettled += paid;
                    }
                }
            }

            group.SettledAmount = totalSettled;
            if (group.TotalAmount > 0 && (totalSettled + group.UserShareAmount) >= group.TotalAmount)
            {
                group.Status = "Settled";
            }

            await session.UpdateAsync(group);
            await tx.CommitAsync();

            return ToGroupDetailDto(group);
        }

        /// <summary>
        /// Updates a SplitGroup's high-level attributes (title, total amount, user share, status).
        /// </summary>
        public async Task<SplitGroupDetailDto?> UpdateGroupAsync(long userId, int groupId, UpdateSplitGroupRequest req)
        {
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var group = await session.Query<SplitGroup>()
                .FirstOrDefaultAsync(g => g.Id == groupId && g.OwnerUserId == userId);

            if (group == null) return null;
            if (GPayEvidenceService.Imported(group)) throw new ArgumentException("Imported GPay records are source-managed. Use Takeout review instead.");

            if (!string.IsNullOrWhiteSpace(req.Title)) group.Title = req.Title.Trim();
            if (req.Description != null) group.Description = req.Description.Trim();
            if (req.Date.HasValue) group.Date = req.Date.Value;
            if (req.TotalAmount.HasValue) group.TotalAmount = req.TotalAmount.Value;
            if (req.UserShareAmount.HasValue) group.UserShareAmount = req.UserShareAmount.Value;
            if (!string.IsNullOrWhiteSpace(req.Status)) group.Status = req.Status.Trim();
            group.UpdatedOn = DateTime.Now;

            await session.UpdateAsync(group);
            await tx.CommitAsync();

            return ToGroupDetailDto(group);
        }

        /// <summary>
        /// Adds a member to an existing SplitGroup and assigns their split amount.
        /// </summary>
        public async Task<SplitGroupMemberDto?> AddMemberAsync(long userId, int groupId, AddSplitMemberRequest req)
        {
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var group = await session.Query<SplitGroup>()
                .FirstOrDefaultAsync(g => g.Id == groupId && g.OwnerUserId == userId);

            if (group == null) return null;
            if (GPayEvidenceService.Imported(group)) throw new ArgumentException("Imported GPay records are source-managed. Use Takeout review instead.");

            var member = new SplitGroupMember
            {
                OwnerUserId = userId,
                Group = group,
                ParticipantName = string.IsNullOrWhiteSpace(req.ParticipantName) ? "Participant" : req.ParticipantName.Trim(),
                ParticipantVpa = req.ParticipantVpa?.Trim(),
                AssignedAmount = req.AssignedAmount,
                PaidAmount = req.PaidAmount,
                IsSettled = req.IsSettled || (req.PaidAmount >= req.AssignedAmount && req.AssignedAmount > 0),
                IsUser = req.IsUser,
                LinkedAccountId = req.LinkedAccountId,
                LinkedBankReference = req.LinkedBankReference,
                LinkedBankType = req.LinkedBankType,
                LinkedTransactionType = req.LinkedTransactionType,
                Notes = req.Notes?.Trim(),
                CreatedOn = DateTime.Now
            };

            await session.SaveAsync(member);
            group.Members.Add(member);

            // Recompute settled total
            group.SettledAmount = group.Members.Where(m => m.IsSettled).Sum(m => m.PaidAmount);
            if (group.TotalAmount > 0 && (group.SettledAmount + group.UserShareAmount) >= group.TotalAmount)
            {
                group.Status = "Settled";
            }
            group.UpdatedOn = DateTime.Now;

            await session.UpdateAsync(group);
            await tx.CommitAsync();

            return ToMemberDto(member);
        }

        /// <summary>
        /// Updates a participant's assigned split amount, paid amount, or settlement status.
        /// </summary>
        public async Task<SplitGroupMemberDto?> UpdateMemberAsync(long userId, int groupId, int memberId, UpdateSplitMemberRequest req)
        {
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var member = await session.Query<SplitGroupMember>()
                .FirstOrDefaultAsync(m => m.Id == memberId && m.Group.Id == groupId && m.OwnerUserId == userId);

            if (member == null) return null;
            if (GPayEvidenceService.Imported(member.Group)) throw new ArgumentException("Imported GPay participants are source-managed. Use Takeout review instead.");
            if (await session.Query<GPaySettlementAllocation>().AnyAsync(a => a.OwnerUserId == userId && a.MemberId == member.Id)) throw new ArgumentException("Remove payment allocations before changing or deleting this participant.");

            if (!string.IsNullOrWhiteSpace(req.ParticipantName)) member.ParticipantName = req.ParticipantName.Trim();
            if (req.ParticipantVpa != null) member.ParticipantVpa = req.ParticipantVpa.Trim();
            if (req.AssignedAmount.HasValue) member.AssignedAmount = req.AssignedAmount.Value;
            if (req.PaidAmount.HasValue) member.PaidAmount = req.PaidAmount.Value;
            if (req.IsSettled.HasValue) member.IsSettled = req.IsSettled.Value;
            if (req.Notes != null) member.Notes = req.Notes.Trim();

            await session.UpdateAsync(member);

            // Update parent group settled amount
            var group = member.Group;
            group.SettledAmount = group.Members.Where(m => m.IsSettled).Sum(m => m.PaidAmount);
            if (group.TotalAmount > 0 && (group.SettledAmount + group.UserShareAmount) >= group.TotalAmount)
            {
                group.Status = "Settled";
            }
            group.UpdatedOn = DateTime.Now;

            await session.UpdateAsync(group);
            await tx.CommitAsync();

            return ToMemberDto(member);
        }

        /// <summary>
        /// Links a bank transaction (e.g. incoming credit) to a participant's split share.
        /// </summary>
        public async Task<SplitGroupMemberDto?> LinkTransactionToMemberAsync(long userId, int groupId, int memberId, LinkTransactionRequest req)
        {
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var member = await session.Query<SplitGroupMember>()
                .FirstOrDefaultAsync(m => m.Id == memberId && m.Group.Id == groupId && m.OwnerUserId == userId);

            if (member == null) return null;

            var names = await GPayEvidenceService.OwnerNames(session, userId);
            var own = GPayEvidenceService.IsCreator(member.Group, names);
            var self = GPayEvidenceService.IsSelf(member, names);
            if (own == self) throw new ArgumentException("This participant is not an owner repayment flow. Review identity before linking.");
            var ownedIds = AccountAccess.OwnedIds(session, userId);
            var payment = await session.Query<BankTransaction>().ExcludeOwnMoneyMoves().FirstOrDefaultAsync(t => ownedIds.Contains(t.AccountId) && t.AccountId == req.AccountId && t.BankReference == req.BankReference && t.BankType == req.BankType && t.TransactionType == req.TransactionType);
            if (payment == null || payment.Mode == "TRANSFER" || (own ? payment.Credit : payment.Debit) <= 0) throw new ArgumentException(own ? "Select an incoming credit from an owned account." : "Select an outgoing repayment debit from an owned account.");
            await session.LockAsync(payment, NHibernate.LockMode.Upgrade);
            await session.LockAsync(member.Group, NHibernate.LockMode.Upgrade);
            await session.LockAsync(member, NHibernate.LockMode.Upgrade);
            await session.RefreshAsync(member);
            if (member.LinkedBankReference != null) throw new ArgumentException("Participant already has a bank link. Unlink it before selecting a different payment.");
            var alreadyLinked = await session.Query<SplitGroupMember>().AnyAsync(m => m.Id != member.Id && m.OwnerUserId == userId && m.LinkedAccountId == payment.AccountId && m.LinkedBankReference == payment.BankReference && m.LinkedBankType == payment.BankType && m.LinkedTransactionType == payment.TransactionType);
            var allocated = await session.Query<GPaySettlementAllocation>().AnyAsync(a => a.OwnerUserId == userId && (a.MemberId == member.Id || a.AccountId == payment.AccountId && a.BankReference == payment.BankReference && a.BankType == payment.BankType && a.TransactionType == payment.TransactionType));
            var billLink = await session.Query<SplitGroup>().AnyAsync(g => g.OwnerUserId == userId && g.ParentAccountId == payment.AccountId && g.ParentBankReference == payment.BankReference && g.ParentBankType == payment.BankType && g.ParentTransactionType == payment.TransactionType);
            if (alreadyLinked || allocated || billLink) throw new ArgumentException("Transaction or participant is already linked/allocated. Review existing links first.");
            var amount = own ? payment.Credit : payment.Debit;
            if (amount > member.AssignedAmount) throw new ArgumentException("Payment exceeds this share. Use a partial allocation in Takeout review.");
            member.IsUser = self;
            member.LinkedAccountId = payment.AccountId;
            member.LinkedBankReference = payment.BankReference;
            member.LinkedBankType = payment.BankType;
            member.LinkedTransactionType = payment.TransactionType;
            member.PaidAmount = amount;
            member.IsSettled = amount >= member.AssignedAmount;
            member.SettlementEvidence = "Bank verified";

            await session.UpdateAsync(member);

            var group = member.Group;
            GPayEvidenceService.Recalculate(group, names);

            await session.UpdateAsync(group);
            await tx.CommitAsync();

            return ToMemberDto(member);
        }

        /// <summary>
        /// Unlinks the bank transaction from a participant's split share.
        /// </summary>
        public async Task<SplitGroupMemberDto?> UnlinkTransactionFromMemberAsync(long userId, int groupId, int memberId)
        {
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var member = await session.Query<SplitGroupMember>()
                .FirstOrDefaultAsync(m => m.Id == memberId && m.Group.Id == groupId && m.OwnerUserId == userId);

            if (member == null) return null;

            member.LinkedAccountId = null;
            member.LinkedBankReference = null;
            member.LinkedBankType = null;
            member.LinkedTransactionType = null;
            member.PaidAmount = GPayEvidenceService.IsPaid(member.SourceState) ? member.AssignedAmount : 0;
            member.IsSettled = GPayEvidenceService.IsPaid(member.SourceState);
            member.SettlementEvidence = GPayEvidenceService.Evidence(member.SourceState);

            await session.UpdateAsync(member);

            var group = member.Group;
            GPayEvidenceService.Recalculate(group, await GPayEvidenceService.OwnerNames(session,userId));

            await session.UpdateAsync(group);
            await tx.CommitAsync();

            return ToMemberDto(member);
        }

        /// <summary>
        /// Deletes a member from the split group.
        /// </summary>
        public async Task<bool> DeleteMemberAsync(long userId, int groupId, int memberId)
        {
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var member = await session.Query<SplitGroupMember>()
                .FirstOrDefaultAsync(m => m.Id == memberId && m.Group.Id == groupId && m.OwnerUserId == userId);

            if (member == null) return false;
            if (GPayEvidenceService.Imported(member.Group)) throw new ArgumentException("Imported GPay participants are source-managed. Use Takeout review instead.");
            if (await session.Query<GPaySettlementAllocation>().AnyAsync(a => a.OwnerUserId == userId && a.MemberId == member.Id)) throw new ArgumentException("Remove payment allocations before changing or deleting this participant.");

            var group = member.Group;
            group.Members.Remove(member);
            await session.DeleteAsync(member);

            group.SettledAmount = group.Members.Where(m => m.IsSettled).Sum(m => m.PaidAmount);
            group.UpdatedOn = DateTime.Now;

            await session.UpdateAsync(group);
            await tx.CommitAsync();

            return true;
        }

        /// <summary>
        /// Deletes a split group and all of its member records.
        /// </summary>
        public async Task<bool> DeleteGroupAsync(long userId, int groupId)
        {
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var group = await session.Query<SplitGroup>()
                .FirstOrDefaultAsync(g => g.Id == groupId && g.OwnerUserId == userId);

            if (group == null) return false;
            if (GPayEvidenceService.Imported(group)) throw new ArgumentException("Imported GPay records are source-managed. Use Takeout review instead.");
            if (await session.Query<GPaySettlementAllocation>().AnyAsync(a => a.OwnerUserId == userId && a.SplitId == group.Id)) throw new ArgumentException("Remove payment allocations before deleting this custom split.");

            await session.DeleteAsync(group);
            await tx.CommitAsync();

            return true;
        }

        /// <summary>
        /// Retrieves candidate transactions across user's accounts to pick as a split parent or participant payment.
        /// </summary>
        public async Task<List<CandidateTransactionDto>> GetCandidateTransactionsAsync(
            long userId,
            string? direction = null,
            string? search = null,
            int limit = 50)
        {
            using var session = DbHelper.GetSession();
            var accountIds = AccountAccess.OwnedIds(session, userId);
            if (accountIds.Count == 0) return new List<CandidateTransactionDto>();

            var query = session.Query<BankTransaction>()
                .ExcludeOwnMoneyMoves()
                .Where(t => accountIds.Contains(t.AccountId));

            if (!string.IsNullOrWhiteSpace(direction))
            {
                var d = direction.ToUpperInvariant();
                if (d.StartsWith("DR") || d.StartsWith("DEBIT"))
                    query = query.Where(t => t.Debit > 0 || t.TransactionType == "DR");
                else if (d.StartsWith("CR") || d.StartsWith("CREDIT"))
                    query = query.Where(t => t.Credit > 0 || t.TransactionType == "CR");
            }

            if (!string.IsNullOrWhiteSpace(search))
            {
                var s = search.Trim().ToLower();
                query = query.Where(t =>
                    (t.Description != null && t.Description.ToLower().Contains(s)) ||
                    (t.Narration != null && t.Narration.ToLower().Contains(s)) ||
                    (t.CounterParty != null && t.CounterParty.Name.ToLower().Contains(s)) ||
                    (t.UpiVpa != null && t.UpiVpa.ToLower().Contains(s)));
            }

            var rows = await query
                .OrderByDescending(t => t.TransactionDate)
                .Take(limit)
                .Select(t => new CandidateTransactionDto
                {
                    AccountId = t.AccountId,
                    BankReference = t.BankReference,
                    BankType = t.BankType,
                    TransactionType = t.TransactionType,
                    Date = t.TransactionDate,
                    Debit = t.Debit,
                    Credit = t.Credit,
                    Amount = t.Debit > 0 ? t.Debit : t.Credit,
                    Direction = t.Debit > 0 ? "Debit" : "Credit",
                    Narration = t.Narration ?? t.Description ?? string.Empty,
                    CounterPartyName = t.CounterParty != null ? (t.CounterParty.FriendlyName ?? t.CounterParty.Name) : string.Empty,
                    UpiVpa = t.UpiVpa ?? string.Empty,
                    UpiReference = t.UpiReference ?? string.Empty,
                    Mode = t.Mode ?? string.Empty
                })
                .ToListAsync();

            return rows;
        }

        // ────────────────────────────────────────────────────────────────────
        // PARTICIPANT SUGGESTIONS
        // ────────────────────────────────────────────────────────────────────

        /// <summary>
        /// Retrieves smart suggestions for participants based on frequent UPI contacts and past splits.
        /// </summary>
        public async Task<List<ParticipantSuggestionDto>> GetParticipantSuggestionsAsync(long userId, string? search = null, int limit = 20)
        {
            using var session = DbHelper.GetSession();
            var accountIds = AccountAccess.OwnedIds(session, userId);

            var querySearch = search?.Trim().ToLowerInvariant();

            // 1. Group members from persistent groups
            var groupMembers = await session.Query<BillGroupMember>()
                .Where(m => m.OwnerUserId == userId)
                .Select(m => new { m.Name, m.Vpa })
                .ToListAsync();

            // 2. Members from previous split groups
            var splitMembers = await session.Query<SplitGroupMember>()
                .Where(m => m.OwnerUserId == userId && !m.IsUser)
                .Select(m => new { Name = m.ParticipantName, Vpa = m.ParticipantVpa })
                .ToListAsync();

            // 3. Counterparties from UPI transactions
            var upiTransactions = new List<(string Name, string? Vpa)>();
            if (accountIds.Count > 0)
            {
                var rawTxs = await session.Query<BankTransaction>()
                    .Where(t => accountIds.Contains(t.AccountId) && (t.Mode == "UPI" || t.UpiVpa != null))
                    .OrderByDescending(t => t.TransactionDate)
                    .Take(500)
                    .Select(t => new
                    {
                        Name = t.CounterParty != null ? (t.CounterParty.FriendlyName ?? t.CounterParty.Name) : null,
                        Vpa = t.UpiVpa,
                        Narration = t.Narration
                    })
                    .ToListAsync();

                foreach (var t in rawTxs)
                {
                    var name = t.Name;
                    var vpa = t.Vpa;
                    if (string.IsNullOrWhiteSpace(name) && !string.IsNullOrWhiteSpace(vpa))
                    {
                        var prefix = vpa.Split('@')[0];
                        if (prefix.Length > 0 && !char.IsDigit(prefix[0])) name = prefix;
                    }

                    // Exclude payment gateways / nodal accounts
                    if (!string.IsNullOrWhiteSpace(vpa) && (
                        vpa.Contains("@nodal", StringComparison.OrdinalIgnoreCase) ||
                        vpa.Contains("@razorpay", StringComparison.OrdinalIgnoreCase) ||
                        vpa.Contains("@billdesk", StringComparison.OrdinalIgnoreCase) ||
                        vpa.Contains("@cashfree", StringComparison.OrdinalIgnoreCase) ||
                        vpa.StartsWith("swiggy", StringComparison.OrdinalIgnoreCase) ||
                        vpa.StartsWith("zomato", StringComparison.OrdinalIgnoreCase) ||
                        vpa.StartsWith("uber", StringComparison.OrdinalIgnoreCase) ||
                        vpa.StartsWith("ola", StringComparison.OrdinalIgnoreCase) ||
                        vpa.StartsWith("cred", StringComparison.OrdinalIgnoreCase) ||
                        vpa.StartsWith("amazon", StringComparison.OrdinalIgnoreCase) ||
                        vpa.StartsWith("flipkart", StringComparison.OrdinalIgnoreCase)))
                    {
                        continue;
                    }

                    if (!string.IsNullOrWhiteSpace(name))
                    {
                        upiTransactions.Add((name.Trim(), vpa?.Trim()));
                    }
                }
            }

            // Aggregate frequencies and deduplicate by normalized name
            var dict = new Dictionary<string, (string Name, string? Vpa, int Freq, string Source)>(StringComparer.OrdinalIgnoreCase);

            void AddOrUpdate(string name, string? vpa, int weight, string source)
            {
                if (string.IsNullOrWhiteSpace(name)) return;
                var key = name.Trim().ToLowerInvariant();
                if (dict.TryGetValue(key, out var existing))
                {
                    dict[key] = (existing.Name, existing.Vpa ?? vpa, existing.Freq + weight, existing.Source);
                }
                else
                {
                    dict[key] = (name.Trim(), vpa?.Trim(), weight, source);
                }
            }

            foreach (var gm in groupMembers) AddOrUpdate(gm.Name, gm.Vpa, 15, "GroupMember");
            foreach (var sm in splitMembers) AddOrUpdate(sm.Name, sm.Vpa, 10, "PastSplit");
            foreach (var upi in upiTransactions) AddOrUpdate(upi.Name, upi.Vpa, 1, "UPIContact");

            var list = dict.Values.AsEnumerable();

            if (!string.IsNullOrWhiteSpace(querySearch))
            {
                list = list.Where(x => x.Name.ToLowerInvariant().Contains(querySearch) || (x.Vpa != null && x.Vpa.ToLowerInvariant().Contains(querySearch)));
            }

            return list
                .OrderByDescending(x => x.Freq)
                .Take(limit)
                .Select(x => new ParticipantSuggestionDto
                {
                    Name = x.Name,
                    Vpa = x.Vpa,
                    Frequency = x.Freq,
                    Source = x.Source
                })
                .ToList();
        }

        // ────────────────────────────────────────────────────────────────────
        // PERSISTENT GPAY BILL GROUPS
        // ────────────────────────────────────────────────────────────────────

        /// <summary>
        /// Retrieves all persistent bill groups with members, splits, and owed balances.
        /// </summary>
        public async Task<List<BillGroupDto>> GetBillGroupsAsync(long userId)
        {
            using var session = DbHelper.GetSession();

            var groups = await session.Query<BillGroup>()
                .Where(g => g.OwnerUserId == userId)
                .OrderByDescending(g => g.CreatedOn)
                .ToListAsync();

            var groupIds = groups.Select(g => g.Id).ToList();
            var allSplits = await session.Query<SplitGroup>()
                .Where(s => s.OwnerUserId == userId && s.BillGroupId != null && groupIds.Contains(s.BillGroupId.Value))
                .OrderByDescending(s => s.Date)
                .ToListAsync();

            var splitsByGroup = allSplits.GroupBy(s => s.BillGroupId!.Value).ToDictionary(g => g.Key, g => g.ToList());

            var userNames = await GPayTakeoutService.GetConfiguredUserNamesAsync(userId);

            var result = new List<BillGroupDto>();
            foreach (var g in groups)
            {
                var splits = splitsByGroup.TryGetValue(g.Id, out var sList) ? sList : new List<SplitGroup>();
                var splitDtos = splits.Select(s => ToGroupDetailDto(s, userNames)).ToList();

                var members = (g.Members ?? new List<BillGroupMember>())
                    .Select(m => new BillGroupMemberDto { Id = m.Id, Name = m.Name, Vpa = m.Vpa })
                    .ToList();

                var totalExpenseVolume = splits.Sum(s => s.TotalAmount);
                var userShareVolume = splitDtos.Sum(s => s.UserShareAmount);
                var settledVolume = splitDtos.Sum(s => s.SettledAmount);

                // User paid volume: only expenses where the user was the creator/payer
                var userCreatedSplits = splitDtos.Where(d => d.IsCreatedByUser).ToList();
                var userPaidVolume = userCreatedSplits.Sum(d => d.TotalAmount);

                // Money owed to user: pending repayments on expenses created by the user
                var netOwedToUser = userCreatedSplits.Sum(d => d.PendingAmount);

                // Money user owes: pending personal share on expenses created by friends
                var netOwedByUser = splitDtos.Where(d => !d.IsCreatedByUser).Sum(d => d.PendingAmount);

                var balances = new List<GroupMemberBalanceDto>();
                var userCreatedGroupSplits = splits.Where(s => userCreatedSplits.Any(d => d.Id == s.Id) && s.Status is not ("Closed" or "Cancelled") && s.SourceState != "CLOSED").ToList();
                var splitMembersAcrossSplits = userCreatedGroupSplits.SelectMany(s => s.Members ?? new List<SplitGroupMember>())
                    .Where(m => !GPayEvidenceService.IsSelf(m, userNames))
                    .GroupBy(m => m.ParticipantName.Trim(), StringComparer.OrdinalIgnoreCase);

                var allMemberNames = new HashSet<string>(members.Select(m => m.Name.Trim()), StringComparer.OrdinalIgnoreCase);
                foreach (var smg in splitMembersAcrossSplits) allMemberNames.Add(smg.Key);

                foreach (var memberName in allMemberNames)
                {
                    if (g.GPayProfileId != null ? splits.Any(s => GPayEvidenceService.Normalize(s.GPayOwnerName) == GPayEvidenceService.Normalize(memberName)) : userNames.Contains(GPayEvidenceService.Normalize(memberName))) continue;

                    var matchingSplits = userCreatedGroupSplits.SelectMany(s => s.Members ?? new List<SplitGroupMember>())
                        .Where(m => string.Equals(m.ParticipantName.Trim(), memberName, StringComparison.OrdinalIgnoreCase))
                        .ToList();

                    var totalAssigned = matchingSplits.Sum(m => m.AssignedAmount);
                    var totalPaid = matchingSplits.Sum(m => m.PaidAmount);
                    var owed = Math.Max(0m, totalAssigned - totalPaid);
                    var matchingGroupMember = members.FirstOrDefault(m => string.Equals(m.Name.Trim(), memberName, StringComparison.OrdinalIgnoreCase));

                    balances.Add(new GroupMemberBalanceDto
                    {
                        MemberName = memberName,
                        MemberVpa = matchingGroupMember?.Vpa ?? matchingSplits.FirstOrDefault(m => !string.IsNullOrEmpty(m.ParticipantVpa))?.ParticipantVpa,
                        TotalAssigned = totalAssigned,
                        TotalPaid = totalPaid,
                        OwedAmount = owed,
                        IsSettled = owed <= 0 && totalAssigned > 0
                    });
                }

                result.Add(new BillGroupDto
                {
                    Id = g.Id,
                    Name = g.Name,
                    GPayProfileId = g.GPayProfileId,
                    Description = g.Description,
                    CreatedOn = g.CreatedOn,
                    UpdatedOn = g.UpdatedOn,
                    Members = members,
                    Splits = splitDtos,
                    TotalExpenseVolume = totalExpenseVolume,
                    UserPaidVolume = userPaidVolume,
                    UserShareVolume = userShareVolume,
                    SettledVolume = settledVolume,
                    NetOwedToUser = netOwedToUser,
                    NetOwedByUser = netOwedByUser,
                    Balances = balances
                });
            }

            return result;
        }

        /// <summary>
        /// Retrieves a single persistent bill group by ID.
        /// </summary>
        public async Task<BillGroupDto?> GetBillGroupByIdAsync(long userId, int groupId)
        {
            var all = await GetBillGroupsAsync(userId);
            return all.FirstOrDefault(g => g.Id == groupId);
        }

        /// <summary>
        /// Creates a persistent GPay-style bill group with initial members.
        /// </summary>
        public async Task<BillGroupDto> CreateBillGroupAsync(long userId, CreateBillGroupRequest req)
        {
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var group = new BillGroup
            {
                OwnerUserId = userId,
                Name = string.IsNullOrWhiteSpace(req.Name) ? "New Group" : req.Name.Trim(),
                Description = req.Description?.Trim(),
                CreatedOn = DateTime.Now
            };

            await session.SaveAsync(group);

            if (req.Members != null && req.Members.Count > 0)
            {
                foreach (var m in req.Members)
                {
                    if (string.IsNullOrWhiteSpace(m.Name)) continue;
                    var member = new BillGroupMember
                    {
                        OwnerUserId = userId,
                        Group = group,
                        Name = m.Name.Trim(),
                        Vpa = m.Vpa?.Trim(),
                        CreatedOn = DateTime.Now
                    };
                    await session.SaveAsync(member);
                    group.Members.Add(member);
                }
            }

            await tx.CommitAsync();

            var created = await GetBillGroupByIdAsync(userId, group.Id);
            return created!;
        }

        /// <summary>
        /// Updates a bill group's name or description.
        /// </summary>
        public async Task<BillGroupDto?> UpdateBillGroupAsync(long userId, int groupId, UpdateBillGroupRequest req)
        {
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var group = await session.Query<BillGroup>()
                .FirstOrDefaultAsync(g => g.Id == groupId && g.OwnerUserId == userId);

            if (group == null) return null;
            if (group.Description?.StartsWith("Google Pay Group (") == true || await session.Query<SplitGroup>().AnyAsync(g => g.OwnerUserId == userId && g.BillGroupId == group.Id && g.SourceKey != null)) throw new ArgumentException("Imported groups are source-managed. Custom groups support manual editing.");

            if (!string.IsNullOrWhiteSpace(req.Name)) group.Name = req.Name.Trim();
            if (req.Description != null) group.Description = req.Description.Trim();
            group.UpdatedOn = DateTime.Now;

            await session.UpdateAsync(group);
            await tx.CommitAsync();

            return await GetBillGroupByIdAsync(userId, groupId);
        }

        /// <summary>
        /// Deletes a bill group and unlinks its splits.
        /// </summary>
        public async Task<bool> DeleteBillGroupAsync(long userId, int groupId)
        {
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var group = await session.Query<BillGroup>()
                .FirstOrDefaultAsync(g => g.Id == groupId && g.OwnerUserId == userId);

            if (group == null) return false;
            if (group.Description?.StartsWith("Google Pay Group (") == true || await session.Query<SplitGroup>().AnyAsync(g => g.OwnerUserId == userId && g.BillGroupId == group.Id && g.SourceKey != null)) throw new ArgumentException("Imported groups are source-managed. Custom groups support manual editing.");
            var childIds = (await session.Query<SplitGroup>().Where(g => g.OwnerUserId == userId && g.BillGroupId == group.Id).ToListAsync()).Select(g=>g.Id).ToList();
            if (await session.Query<GPaySettlementAllocation>().AnyAsync(a => a.OwnerUserId == userId && childIds.Contains(a.SplitId))) throw new ArgumentException("Remove child expense allocations before deleting this custom group.");

            var splits = await session.Query<SplitGroup>()
                .Where(s => s.BillGroupId == groupId && s.OwnerUserId == userId)
                .ToListAsync();

            foreach (var s in splits)
            {
                s.BillGroupId = null;
                await session.UpdateAsync(s);
            }

            await session.DeleteAsync(group);
            await tx.CommitAsync();

            return true;
        }

        /// <summary>
        /// Adds a member to an existing bill group.
        /// </summary>
        public async Task<BillGroupMemberDto?> AddBillGroupMemberAsync(long userId, int groupId, AddBillGroupMemberRequest req)
        {
            if (string.IsNullOrWhiteSpace(req.Name)) return null;

            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var group = await session.Query<BillGroup>()
                .FirstOrDefaultAsync(g => g.Id == groupId && g.OwnerUserId == userId);

            if (group == null) return null;
            if (group.Description?.StartsWith("Google Pay Group (") == true || await session.Query<SplitGroup>().AnyAsync(g => g.OwnerUserId == userId && g.BillGroupId == group.Id && g.SourceKey != null)) throw new ArgumentException("Imported groups are source-managed. Custom groups support manual editing.");

            var member = new BillGroupMember
            {
                OwnerUserId = userId,
                Group = group,
                Name = req.Name.Trim(),
                Vpa = req.Vpa?.Trim(),
                CreatedOn = DateTime.Now
            };

            await session.SaveAsync(member);
            group.Members.Add(member);
            group.UpdatedOn = DateTime.Now;

            await session.UpdateAsync(group);
            await tx.CommitAsync();

            return new BillGroupMemberDto { Id = member.Id, Name = member.Name, Vpa = member.Vpa };
        }

        /// <summary>
        /// Removes a member from a bill group.
        /// </summary>
        public async Task<bool> RemoveBillGroupMemberAsync(long userId, int groupId, int memberId)
        {
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var member = await session.Query<BillGroupMember>()
                .FirstOrDefaultAsync(m => m.Id == memberId && m.Group.Id == groupId && m.OwnerUserId == userId);

            if (member == null) return false;
            if (member.Group.Description?.StartsWith("Google Pay Group (") == true) throw new ArgumentException("Imported group membership is reconstructed from history.");

            var group = member.Group;
            group.Members.Remove(member);
            await session.DeleteAsync(member);
            group.UpdatedOn = DateTime.Now;

            await session.UpdateAsync(group);
            await tx.CommitAsync();

            return true;
        }

        // ────────────────────────────────────────────────────────────────────
        // DTO MAPPERS
        // ────────────────────────────────────────────────────────────────────

        private static SplitGroupDetailDto ToGroupDetailDto(SplitGroup g, HashSet<string>? userNames = null)
        {
            var imported = GPayEvidenceService.Imported(g);
            var names = userNames ?? new HashSet<string>();
            var isCreatedByUser = GPayEvidenceService.IsCreator(g, names);
            var creatorName = imported ? GPayEvidenceService.Creator(g) : "You";
            var members = (g.Members ?? new List<SplitGroupMember>()).Select(m => ToMemberDto(m, names)).ToList();
            var isUserInvolved = isCreatedByUser || members.Any(m => m.IsUser);
            var sourceAware = g.SourceState != null;
            var userShare = sourceAware ? members.Where(m => m.IsUser).Sum(m => m.AssignedAmount) : g.UserShareAmount;
            var eligible = members.Where(m => isCreatedByUser ? !m.IsUser : m.IsUser).ToList();
            var inactive = g.Status is "Closed" or "Cancelled" || g.SourceState == "CLOSED";
            var pendingAmount = inactive ? 0 : sourceAware ? eligible.Sum(m => Math.Max(0, m.AssignedAmount - m.PaidAmount)) : g.Status == "Settled" ? 0 : isCreatedByUser ? Math.Max(0,g.TotalAmount-g.SettledAmount-userShare) : eligible.Sum(m=>Math.Max(0,m.AssignedAmount-m.PaidAmount));
            var settledAmount = sourceAware ? eligible.Sum(m => Math.Min(m.AssignedAmount,m.PaidAmount)) : g.SettledAmount;

            return new SplitGroupDetailDto
            {
                Id = g.Id,
                GroupUid = g.GroupUid,
                BillGroupId = g.BillGroupId,
                GroupName = g.GroupName,
                GPayProfileId = g.GPayProfileId,
                Title = g.Title,
                Description = g.Description,
                Date = g.Date,
                TotalAmount = g.TotalAmount,
                UserShareAmount = userShare,
                SourceState = g.SourceState,
                SourceKey = g.SourceKey,
                SourceImportedUtc = g.SourceImportedUtc,
                VerifiedAmount = eligible.Where(m => m.SettlementEvidence is "Bank verified" or "Bank verified allocation").Sum(m => Math.Min(m.AssignedAmount,m.PaidAmount)),
                SettledAmount = settledAmount,
                PendingAmount = pendingAmount,
                Status = g.Status,
                Confidence = g.Confidence,
                SplitType = g.SplitType,
                IsCreatedByUser = isCreatedByUser,
                CreatorName = creatorName,
                IsUserInvolved = isUserInvolved,
                ParentAccountId = g.ParentAccountId,
                ParentBankReference = g.ParentBankReference,
                ParentBankType = g.ParentBankType,
                ParentTransactionType = g.ParentTransactionType,
                CreatedOn = g.CreatedOn,
                UpdatedOn = g.UpdatedOn,
                Members = members
            };
        }

        private static SplitGroupMemberDto ToMemberDto(SplitGroupMember m, HashSet<string>? userNames = null, bool isGroupSettled = false) => new()
        {
            Id = m.Id,
            ParticipantName = m.ParticipantName,
            ParticipantVpa = m.ParticipantVpa,
            AssignedAmount = m.AssignedAmount,
            PaidAmount = m.PaidAmount,
            IsSettled = m.IsSettled,
            IsUser = userNames == null ? m.IsUser : GPayEvidenceService.IsSelf(m, userNames),
            SourceState = m.SourceState,
            SettlementEvidence = m.SettlementEvidence ?? (m.LinkedBankReference != null ? "Legacy link — review" : "Unverified"),
            LinkedAccountId = m.LinkedAccountId,
            LinkedBankReference = m.LinkedBankReference,
            LinkedBankType = m.LinkedBankType,
            LinkedTransactionType = m.LinkedTransactionType,
            Notes = m.Notes,
            CreatedOn = m.CreatedOn
        };

        private sealed class RawUpiRow
        {
            public long AccountId { get; set; }
            public string BankReference { get; set; } = string.Empty;
            public string BankType { get; set; } = string.Empty;
            public string TransactionType { get; set; } = string.Empty;
            public DateTime Date { get; set; }
            public decimal Debit { get; set; }
            public decimal Credit { get; set; }
            public decimal Amount { get; set; }
            public string Direction { get; set; } = string.Empty;
            public string Narration { get; set; } = string.Empty;
            public string UpiReference { get; set; } = string.Empty;
            public string UpiVpa { get; set; } = string.Empty;
            public string CounterPartyName { get; set; } = string.Empty;
            public bool IsGPay { get; set; }
            public List<string> GPayIndicators { get; set; } = new();
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // DTOS
    // ────────────────────────────────────────────────────────────────────────

    public class GPaySplitSuggestionDto
    {
        public DateTime Date { get; set; }
        public decimal InferredTotalAmount { get; set; }
        public decimal InferredUserShare { get; set; }
        public decimal CreditSum { get; set; }
        public int Score { get; set; }
        public string Confidence { get; set; } = "Low";
        public string Classification { get; set; } = "Possible GPay Split";
        public List<string> Evidence { get; set; } = new();
        public SplitLegDto? ParentDebit { get; set; }
        public List<SplitLegDto> CreditLegs { get; set; } = new();
        public List<SuggestedMemberDto> SuggestedMembers { get; set; } = new();
    }

    public class SplitLegDto
    {
        public long AccountId { get; set; }
        public string BankReference { get; set; } = string.Empty;
        public string BankType { get; set; } = string.Empty;
        public string TransactionType { get; set; } = string.Empty;
        public DateTime Date { get; set; }
        public decimal Amount { get; set; }
        public string Direction { get; set; } = string.Empty;
        public string Narration { get; set; } = string.Empty;
        public string UpiReference { get; set; } = string.Empty;
        public string UpiVpa { get; set; } = string.Empty;
        public string CounterPartyName { get; set; } = string.Empty;
        public bool IsGPay { get; set; }
        public List<string> GPayIndicators { get; set; } = new();
    }

    public class SuggestedMemberDto
    {
        public string Name { get; set; } = string.Empty;
        public string? Vpa { get; set; }
        public decimal AssignedAmount { get; set; }
        public string BankReference { get; set; } = string.Empty;
        public string BankType { get; set; } = string.Empty;
        public long AccountId { get; set; }
        public string TransactionType { get; set; } = string.Empty;
    }

    public class SplitGroupDetailDto
    {
        public string? GPayProfileId { get; set; }
        public int Id { get; set; }
        public Guid GroupUid { get; set; }
        public int? BillGroupId { get; set; }
        public string? GroupName { get; set; }
        public string Title { get; set; } = string.Empty;
        public string? Description { get; set; }
        public DateTime Date { get; set; }
        public decimal TotalAmount { get; set; }
        public decimal UserShareAmount { get; set; }
        public decimal SettledAmount { get; set; }
        public decimal PendingAmount { get; set; }
        public string? SourceState { get; set; }
        public string? SourceKey { get; set; }
        public DateTime? SourceImportedUtc { get; set; }
        public decimal VerifiedAmount { get; set; }
        public string Status { get; set; } = string.Empty;
        public string Confidence { get; set; } = string.Empty;
        public string SplitType { get; set; } = string.Empty;
        public bool IsCreatedByUser { get; set; }
        public string? CreatorName { get; set; }
        public bool IsUserInvolved { get; set; }
        public long? ParentAccountId { get; set; }
        public string? ParentBankReference { get; set; }
        public string? ParentBankType { get; set; }
        public string? ParentTransactionType { get; set; }
        public DateTime CreatedOn { get; set; }
        public DateTime? UpdatedOn { get; set; }
        public List<SplitGroupMemberDto> Members { get; set; } = new();
    }

    public class SplitGroupMemberDto
    {
        public int Id { get; set; }
        public string ParticipantName { get; set; } = string.Empty;
        public string? ParticipantVpa { get; set; }
        public decimal AssignedAmount { get; set; }
        public decimal PaidAmount { get; set; }
        public string? SourceState { get; set; }
        public string? SettlementEvidence { get; set; }
        public bool IsSettled { get; set; }
        public bool IsUser { get; set; }
        public long? LinkedAccountId { get; set; }
        public string? LinkedBankReference { get; set; }
        public string? LinkedBankType { get; set; }
        public string? LinkedTransactionType { get; set; }
        public string? Notes { get; set; }
        public DateTime CreatedOn { get; set; }
    }

    public class CreateSplitGroupRequest
    {
        public int? BillGroupId { get; set; }
        public string? GroupName { get; set; }
        public string Title { get; set; } = string.Empty;
        public string? Description { get; set; }
        public DateTime Date { get; set; } = DateTime.Today;
        public decimal TotalAmount { get; set; }
        public decimal UserShareAmount { get; set; }
        public string? Confidence { get; set; }
        public string? SplitType { get; set; }
        public long? ParentAccountId { get; set; }
        public string? ParentBankReference { get; set; }
        public string? ParentBankType { get; set; }
        public string? ParentTransactionType { get; set; }
        public List<CreateSplitMemberItemRequest> Members { get; set; } = new();
    }

    public class CreateSplitMemberItemRequest
    {
        public string ParticipantName { get; set; } = string.Empty;
        public string? ParticipantVpa { get; set; }
        public decimal AssignedAmount { get; set; }
        public decimal PaidAmount { get; set; }
        public bool IsSettled { get; set; }
        public bool IsUser { get; set; }
        public long? LinkedAccountId { get; set; }
        public string? LinkedBankReference { get; set; }
        public string? LinkedBankType { get; set; }
        public string? LinkedTransactionType { get; set; }
        public string? Notes { get; set; }
    }

    public class UpdateSplitGroupRequest
    {
        public string? Title { get; set; }
        public string? Description { get; set; }
        public DateTime? Date { get; set; }
        public decimal? TotalAmount { get; set; }
        public decimal? UserShareAmount { get; set; }
        public string? Status { get; set; }
    }

    public class AddSplitMemberRequest
    {
        public string ParticipantName { get; set; } = string.Empty;
        public string? ParticipantVpa { get; set; }
        public decimal AssignedAmount { get; set; }
        public decimal PaidAmount { get; set; }
        public bool IsSettled { get; set; }
        public bool IsUser { get; set; }
        public long? LinkedAccountId { get; set; }
        public string? LinkedBankReference { get; set; }
        public string? LinkedBankType { get; set; }
        public string? LinkedTransactionType { get; set; }
        public string? Notes { get; set; }
    }

    public class UpdateSplitMemberRequest
    {
        public string? ParticipantName { get; set; }
        public string? ParticipantVpa { get; set; }
        public decimal? AssignedAmount { get; set; }
        public decimal? PaidAmount { get; set; }
        public bool? IsSettled { get; set; }
        public string? Notes { get; set; }
    }

    public class LinkTransactionRequest
    {
        public long AccountId { get; set; }
        public string BankReference { get; set; } = string.Empty;
        public string BankType { get; set; } = string.Empty;
        public string TransactionType { get; set; } = "CR";
        public decimal? Amount { get; set; }
    }

    public class CandidateTransactionDto
    {
        public long AccountId { get; set; }
        public string BankReference { get; set; } = string.Empty;
        public string BankType { get; set; } = string.Empty;
        public string TransactionType { get; set; } = string.Empty;
        public DateTime Date { get; set; }
        public decimal Debit { get; set; }
        public decimal Credit { get; set; }
        public decimal Amount { get; set; }
        public string Direction { get; set; } = string.Empty;
        public string Narration { get; set; } = string.Empty;
        public string CounterPartyName { get; set; } = string.Empty;
        public string UpiVpa { get; set; } = string.Empty;
        public string UpiReference { get; set; } = string.Empty;
        public string Mode { get; set; } = string.Empty;
    }

    public class ParticipantSuggestionDto
    {
        public string Name { get; set; } = string.Empty;
        public string? Vpa { get; set; }
        public int Frequency { get; set; }
        public string Source { get; set; } = "UPI";
    }

    public class BillGroupDto
    {
        public string? GPayProfileId { get; set; }
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public string? Description { get; set; }
        public DateTime CreatedOn { get; set; }
        public DateTime? UpdatedOn { get; set; }
        public List<BillGroupMemberDto> Members { get; set; } = new();
        public List<SplitGroupDetailDto> Splits { get; set; } = new();
        public decimal TotalExpenseVolume { get; set; }
        public decimal UserPaidVolume { get; set; }
        public decimal UserShareVolume { get; set; }
        public decimal SettledVolume { get; set; }
        public decimal NetOwedToUser { get; set; }
        public decimal NetOwedByUser { get; set; }
        public List<GroupMemberBalanceDto> Balances { get; set; } = new();
    }

    public class BillGroupMemberDto
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public string? Vpa { get; set; }
    }

    public class GroupMemberBalanceDto
    {
        public string MemberName { get; set; } = string.Empty;
        public string? MemberVpa { get; set; }
        public decimal TotalAssigned { get; set; }
        public decimal TotalPaid { get; set; }
        public decimal OwedAmount { get; set; }
        public bool IsSettled { get; set; }
    }

    public class CreateBillGroupRequest
    {
        public string Name { get; set; } = string.Empty;
        public string? Description { get; set; }
        public List<AddBillGroupMemberRequest> Members { get; set; } = new();
    }

    public class UpdateBillGroupRequest
    {
        public string? Name { get; set; }
        public string? Description { get; set; }
    }

    public class AddBillGroupMemberRequest
    {
        public string Name { get; set; } = string.Empty;
        public string? Vpa { get; set; }
    }
}
