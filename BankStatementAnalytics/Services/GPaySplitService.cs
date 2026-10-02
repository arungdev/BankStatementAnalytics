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
    public class GPaySplitService
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
            var alreadyLinkedRefs = session.Query<SplitGroupMember>()
                .Where(m => m.OwnerUserId == userId && m.LinkedBankReference != null)
                .Select(m => m.LinkedBankReference!)
                .Distinct()
                .ToHashSet();

            var alreadyParentRefs = session.Query<SplitGroup>()
                .Where(g => g.OwnerUserId == userId && g.ParentBankReference != null)
                .Select(g => g.ParentBankReference!)
                .Distinct()
                .ToHashSet();

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
                .Where(r => !alreadyLinkedRefs.Contains(r.BankReference) && !alreadyParentRefs.Contains(r.BankReference))
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

            decimal inferredTotal = matchingDebit != null ? matchingDebit.Amount : (creditSum + avgAmount);
            decimal inferredUserShare = inferredTotal - creditSum;
            if (inferredUserShare < 0) inferredUserShare = avgAmount;

            var evidence = new List<string>
            {
                $"{totalLegs} incoming credits received on {date:dd/MM/yyyy}",
                $"{distinctVpas} distinct counterparty VPAs involved",
                $"Amounts: {string.Join(", ", credits.Select(c => $"₹{c.Amount:N2}"))}",
                $"Google Pay (@ok*) handles identified: {gpayCount}/{totalLegs}"
            };

            if (matchingDebit != null)
            {
                evidence.Add($"Matching bill debit found: ₹{matchingDebit.Amount:N2} to '{matchingDebit.CounterPartyName}' on {matchingDebit.Date:dd/MM/yyyy}");
            }

            string confidence;
            string classification;

            if (gpayCount >= 2 && matchingDebit != null)
            {
                confidence = "Medium";
                classification = "Possible GPay Split";
            }
            else if (gpayCount >= 2)
            {
                confidence = "Medium";
                classification = "Possible GPay Group Payment";
            }
            else if (matchingDebit != null)
            {
                confidence = "Low";
                classification = "Possible GPay Split";
            }
            else
            {
                confidence = "Low";
                classification = "Cannot Determine";
            }

            var suggestion = new GPaySplitSuggestionDto
            {
                Date = date,
                InferredTotalAmount = inferredTotal,
                InferredUserShare = inferredUserShare,
                CreditSum = creditSum,
                Confidence = confidence,
                Classification = classification,
                Evidence = evidence,
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
            using var session = DbHelper.GetSession();

            var groups = await session.Query<SplitGroup>()
                .Where(g => g.OwnerUserId == userId)
                .OrderByDescending(g => g.Date)
                .ToListAsync();

            return groups.Select(ToGroupDetailDto).ToList();
        }

        /// <summary>
        /// Retrieves a single split group by Id.
        /// </summary>
        public async Task<SplitGroupDetailDto?> GetGroupByIdAsync(long userId, int groupId)
        {
            using var session = DbHelper.GetSession();

            var group = await session.Query<SplitGroup>()
                .FirstOrDefaultAsync(g => g.Id == groupId && g.OwnerUserId == userId);

            return group != null ? ToGroupDetailDto(group) : null;
        }

        /// <summary>
        /// Creates a new SplitGroup, with manual or auto-assigned member shares.
        /// </summary>
        public async Task<SplitGroupDetailDto> CreateGroupAsync(long userId, CreateSplitGroupRequest req)
        {
            using var session = DbHelper.GetSession();
            using var tx = session.BeginTransaction();

            var group = new SplitGroup
            {
                OwnerUserId = userId,
                GroupUid = Guid.NewGuid(),
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

            member.LinkedAccountId = req.AccountId;
            member.LinkedBankReference = req.BankReference;
            member.LinkedBankType = req.BankType;
            member.LinkedTransactionType = req.TransactionType;

            if (req.Amount.HasValue && req.Amount.Value > 0)
            {
                member.PaidAmount = req.Amount.Value;
            }
            else if (member.PaidAmount <= 0)
            {
                member.PaidAmount = member.AssignedAmount;
            }

            member.IsSettled = true;

            await session.UpdateAsync(member);

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
            member.PaidAmount = 0m;
            member.IsSettled = false;

            await session.UpdateAsync(member);

            var group = member.Group;
            group.SettledAmount = group.Members.Where(m => m.IsSettled).Sum(m => m.PaidAmount);
            group.Status = "Active";
            group.UpdatedOn = DateTime.Now;

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
        // DTO MAPPERS
        // ────────────────────────────────────────────────────────────────────

        private static SplitGroupDetailDto ToGroupDetailDto(SplitGroup g)
        {
            var members = (g.Members ?? new List<SplitGroupMember>()).Select(ToMemberDto).ToList();
            var totalAssigned = members.Sum(m => m.AssignedAmount);
            var pendingAmount = Math.Max(0m, g.TotalAmount - g.SettledAmount - g.UserShareAmount);

            return new SplitGroupDetailDto
            {
                Id = g.Id,
                GroupUid = g.GroupUid,
                Title = g.Title,
                Description = g.Description,
                Date = g.Date,
                TotalAmount = g.TotalAmount,
                UserShareAmount = g.UserShareAmount,
                SettledAmount = g.SettledAmount,
                PendingAmount = pendingAmount,
                Status = g.Status,
                Confidence = g.Confidence,
                SplitType = g.SplitType,
                ParentAccountId = g.ParentAccountId,
                ParentBankReference = g.ParentBankReference,
                ParentBankType = g.ParentBankType,
                ParentTransactionType = g.ParentTransactionType,
                CreatedOn = g.CreatedOn,
                UpdatedOn = g.UpdatedOn,
                Members = members
            };
        }

        private static SplitGroupMemberDto ToMemberDto(SplitGroupMember m) => new()
        {
            Id = m.Id,
            ParticipantName = m.ParticipantName,
            ParticipantVpa = m.ParticipantVpa,
            AssignedAmount = m.AssignedAmount,
            PaidAmount = m.PaidAmount,
            IsSettled = m.IsSettled,
            IsUser = m.IsUser,
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
        public int Id { get; set; }
        public Guid GroupUid { get; set; }
        public string Title { get; set; } = string.Empty;
        public string? Description { get; set; }
        public DateTime Date { get; set; }
        public decimal TotalAmount { get; set; }
        public decimal UserShareAmount { get; set; }
        public decimal SettledAmount { get; set; }
        public decimal PendingAmount { get; set; }
        public string Status { get; set; } = string.Empty;
        public string Confidence { get; set; } = string.Empty;
        public string SplitType { get; set; } = string.Empty;
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
}
