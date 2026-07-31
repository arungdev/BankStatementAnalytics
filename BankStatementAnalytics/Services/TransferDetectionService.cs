using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using NHibernate.Linq;
using Common.Framework.Data;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Services
{
    /// <summary>
    /// Detects money moved between the user's own accounts: a debit in one owned account
    /// matched to an equal credit in a different owned account within a few days
    /// (e.g. an HDFC → IOB UPI/NEFT self-transfer). Without this, the same rupees count
    /// as spend in one account and income in the other. Confirmed pairs share a
    /// <see cref="BankTransaction.TransferGroupId"/>, which analytics exclude via
    /// <see cref="DetectionQuery.ExcludeOwnMoneyMoves"/>.
    /// </summary>
    public class TransferDetectionService
    {
        // Settlement can post on different dates in the two accounts (NEFT cut-offs,
        // value-date differences), but beyond a few days equal amounts are coincidence.
        private const int MaxDaysApart = 3;
        private const int LookbackMonths = 24;

        /// <summary>Unconfirmed debit↔credit pairs across the user's accounts, newest first.</summary>
        public List<TransferPairView> DetectSuggestions(long userId)
        {
            using var session = DbHelper.GetSession();

            var accounts = OwnedAccountLabels(session, userId);
            if (accounts.Count < 2)
                return new List<TransferPairView>();

            var rows = LoadRows(session, accounts.Keys.ToList(), onlyMarked: false);

            var debits = rows.Where(r => r.Debit > 0).OrderByDescending(r => r.Date).ToList();
            var creditsByAmount = rows.Where(r => r.Credit > 0)
                .GroupBy(r => r.Credit)
                .ToDictionary(g => g.Key, g => g.ToList());

            var usedCredits = new HashSet<TransferRow>();
            var pairs = new List<TransferPairView>();

            foreach (var debit in debits)
            {
                if (!creditsByAmount.TryGetValue(debit.Debit, out var credits))
                    continue;

                // Nearest-dated unused credit in a different account wins; each row
                // belongs to at most one pair.
                TransferRow? best = null;
                var bestGap = int.MaxValue;
                foreach (var credit in credits)
                {
                    if (credit.AccountId == debit.AccountId || usedCredits.Contains(credit))
                        continue;
                    var gap = Math.Abs((credit.Date.Date - debit.Date.Date).Days);
                    if (gap <= MaxDaysApart && gap < bestGap)
                    {
                        best = credit;
                        bestGap = gap;
                    }
                }

                if (best == null)
                    continue;

                usedCredits.Add(best);
                pairs.Add(ToView(null, debit, best, accounts));
            }

            return pairs;
        }

        /// <summary>Confirmed transfer pairs (rows sharing a TransferGroupId), newest first.</summary>
        public List<TransferPairView> GetMarked(long userId)
        {
            using var session = DbHelper.GetSession();

            var accounts = OwnedAccountLabels(session, userId);
            if (accounts.Count == 0)
                return new List<TransferPairView>();

            var rows = LoadRows(session, accounts.Keys.ToList(), onlyMarked: true);

            return rows
                .GroupBy(r => r.TransferGroupId!.Value)
                .Select(g =>
                {
                    var debit = g.FirstOrDefault(r => r.Debit > 0);
                    var credit = g.FirstOrDefault(r => r.Credit > 0);
                    return debit != null && credit != null ? ToView(g.Key, debit, credit, accounts) : null;
                })
                .Where(v => v != null)
                .Select(v => v!)
                .OrderByDescending(v => v.Date)
                .ToList();
        }

        /// <summary>
        /// Links a debit and a credit leg as one transfer. Returns the new group id, or null
        /// when the legs don't form a valid pair (not owned, same account, amounts differ,
        /// or either row is already part of a transfer).
        /// </summary>
        public async Task<Guid?> MarkPairAsync(long userId, TransferLegKey fromLeg, TransferLegKey toLeg)
        {
            using var session = DbHelper.GetSession();

            var owned = AccountAccess.OwnedIdSet(session, userId);
            if (!owned.Contains(fromLeg.AccountId) || !owned.Contains(toLeg.AccountId)
                || fromLeg.AccountId == toLeg.AccountId)
                return null;

            var debit = LoadLeg(session, fromLeg);
            var credit = LoadLeg(session, toLeg);
            if (debit == null || credit == null
                || debit.TransferGroupId != null || credit.TransferGroupId != null
                || debit.Debit <= 0 || credit.Credit <= 0 || debit.Debit != credit.Credit)
                return null;

            using var tx = session.BeginTransaction();
            var groupId = Guid.NewGuid();
            debit.TransferGroupId = groupId;
            credit.TransferGroupId = groupId;
            await session.UpdateAsync(debit);
            await session.UpdateAsync(credit);
            await tx.CommitAsync();
            return groupId;
        }

        /// <summary>Unlinks a confirmed pair so both rows count in analytics again.</summary>
        public async Task<bool> UnmarkAsync(long userId, Guid groupId)
        {
            using var session = DbHelper.GetSession();

            var owned = AccountAccess.OwnedIds(session, userId);
            var legs = session.Query<BankTransaction>()
                .Where(t => owned.Contains(t.AccountId) && t.TransferGroupId == groupId)
                .ToList();
            if (legs.Count == 0)
                return false;

            using var tx = session.BeginTransaction();
            foreach (var leg in legs)
            {
                leg.TransferGroupId = null;
                await session.UpdateAsync(leg);
            }
            await tx.CommitAsync();
            return true;
        }

        // BankTransaction has a composed id — load by all four key columns.
        private static BankTransaction? LoadLeg(NHibernate.ISession session, TransferLegKey key) =>
            session.Query<BankTransaction>()
                .FirstOrDefault(t => t.AccountId == key.AccountId
                                  && t.BankReference == key.BankReference
                                  && t.BankType == key.BankType
                                  && t.TransactionType == key.TransactionType);

        private static List<TransferRow> LoadRows(NHibernate.ISession session, List<long> accountIds, bool onlyMarked)
        {
            var from = DateTime.Today.AddMonths(-LookbackMonths);
            var query = session.Query<BankTransaction>()
                .Where(t => accountIds.Contains(t.AccountId) && t.TransactionDate >= from);

            query = onlyMarked
                ? query.Where(t => t.TransferGroupId != null)
                // Candidates: unmarked rows that aren't already parser-tagged CC bill payments.
                : query.Where(t => t.TransferGroupId == null
                                && (t.Mode == null || t.Mode != "TRANSFER")
                                && (t.Debit > 0 || t.Credit > 0));

            return query
                .Select(t => new TransferRow
                {
                    AccountId = t.AccountId,
                    BankReference = t.BankReference,
                    BankType = t.BankType,
                    TransactionType = t.TransactionType,
                    Date = t.TransactionDate,
                    ValueDate = t.ValueDate,
                    Debit = t.Debit,
                    Credit = t.Credit,
                    Balance = t.Balance,
                    Mode = t.Mode,
                    Narration = t.Narration,
                    Description = t.Description,
                    UpiReference = t.UpiReference,
                    UpiVpa = t.UpiVpa,
                    Note = t.Note,
                    CounterPartyName = t.CounterParty != null ? t.CounterParty.Name : null,
                    CounterPartyFriendlyName = t.CounterParty != null ? t.CounterParty.FriendlyName : null,
                    Category = t.CategoryOverride ?? (t.CounterParty != null ? t.CounterParty.Category : null),
                    SubCategory = t.SubCategoryOverride ?? (t.CounterParty != null ? t.CounterParty.SubCategory : null),
                    TransferGroupId = t.TransferGroupId
                })
                .ToList();
        }

        private static Dictionary<long, string> OwnedAccountLabels(NHibernate.ISession session, long userId) =>
            session.Query<Account>()
                .Where(a => a.OwnerUserId == userId)
                .ToList()
                .ToDictionary(a => a.Id, a => $"{a.BankName} {LastFour(a.AccountNumber)}");

        private static string LastFour(string accountNumber)
        {
            var digits = (accountNumber ?? string.Empty).Trim();
            return digits.Length <= 4 ? digits : "··" + digits[^4..];
        }

        private static TransferPairView ToView(
            Guid? groupId, TransferRow debit, TransferRow credit, Dictionary<long, string> accounts)
        {
            var shared = SharedNames(debit, credit);
            return new TransferPairView
            {
                GroupId = groupId,
                Amount = debit.Debit,
                Date = debit.Date,
                DaysApart = Math.Abs((credit.Date.Date - debit.Date.Date).Days),
                // A credit posting before its debit is legitimate (value-date skew) but is a
                // weaker signal than the usual debit-then-credit order.
                CreditPostedFirst = credit.Date.Date < debit.Date.Date,
                SharedNames = shared,
                Confidence = Score(debit, credit, shared),
                From = ToLegView(debit, accounts),
                To = ToLegView(credit, accounts)
            };
        }

        /// <summary>
        /// How much the pair looks like a genuine self-transfer rather than two unrelated
        /// rows that happen to share an amount. Equal amounts alone are weak evidence —
        /// round figures (₹500, ₹1,000) collide often — so a name shared by both narrations
        /// is what lifts a pair above "possible".
        /// </summary>
        private static string Score(TransferRow debit, TransferRow credit, List<string> shared)
        {
            if (shared.Count > 0)
                return debit.Date.Date == credit.Date.Date ? "high" : "medium";

            // No common name: only same-day, non-round amounts stay above the noise floor.
            var round = debit.Debit % 500 == 0;
            return !round && debit.Date.Date == credit.Date.Date ? "medium" : "low";
        }

        // Banking boilerplate that appears on both legs of unrelated rows and so proves nothing.
        private static readonly HashSet<string> NoiseTokens = new(StringComparer.OrdinalIgnoreCase)
        {
            "UPI", "NEFT", "IMPS", "RTGS", "TRF", "TRANSFER", "PAYMENT", "PAYMENTS", "BANK",
            "ACCOUNT", "FROM", "SENT", "RECD", "RECEIVED", "OKAXIS", "OKICICI", "OKHDFCBANK",
            "OKSBI", "YBL", "PAYTM", "IBL", "AXL", "AXIS", "HDFC", "ICICI", "SBIN", "INDB",
            "CARD", "CREDIT", "DEBIT", "SELF", "FUND", "FUNDS", "ONLINE", "MOBILE", "COLLECT"
        };

        /// <summary>
        /// Name-ish words appearing in both legs' narration/VPA/merchant text — the strongest
        /// available hint that the two rows describe the same movement of money.
        /// </summary>
        private static List<string> SharedNames(TransferRow debit, TransferRow credit)
        {
            var a = NameTokens(debit);
            a.IntersectWith(NameTokens(credit));
            return a.OrderBy(t => t).Take(4).ToList();
        }

        private static HashSet<string> NameTokens(TransferRow row)
        {
            var text = string.Join(' ',
                row.Narration, row.Description, row.UpiVpa,
                row.CounterPartyFriendlyName, row.CounterPartyName);

            var tokens = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var raw in text.Split(new[] { ' ', '/', '-', '.', '@', ':', ',', '*', '(', ')' },
                                           StringSplitOptions.RemoveEmptyEntries))
            {
                // Letters only and long enough to be a name — digits are reference numbers,
                // which never match across two different banks' formats.
                if (raw.Length < 4 || !raw.All(char.IsLetter) || NoiseTokens.Contains(raw))
                    continue;
                tokens.Add(raw.ToUpperInvariant());
            }
            return tokens;
        }

        private static TransferLegView ToLegView(TransferRow row, Dictionary<long, string> accounts) => new()
        {
            AccountId = row.AccountId,
            AccountName = accounts.TryGetValue(row.AccountId, out var name) ? name : $"Account {row.AccountId}",
            BankReference = row.BankReference,
            BankType = row.BankType,
            TransactionType = row.TransactionType,
            Date = row.Date,
            ValueDate = row.ValueDate,
            Description = !string.IsNullOrWhiteSpace(row.Narration) ? row.Narration! : row.Description ?? string.Empty,
            Narration = row.Narration ?? string.Empty,
            RawDescription = row.Description ?? string.Empty,
            Amount = row.Debit > 0 ? row.Debit : row.Credit,
            Direction = row.Debit > 0 ? "Debit" : "Credit",
            Balance = row.Balance,
            UpiReference = row.UpiReference ?? string.Empty,
            UpiVpa = row.UpiVpa ?? string.Empty,
            Note = row.Note ?? string.Empty,
            Merchant = !string.IsNullOrWhiteSpace(row.CounterPartyFriendlyName)
                ? row.CounterPartyFriendlyName!
                : row.CounterPartyName ?? string.Empty,
            Category = row.Category ?? string.Empty,
            SubCategory = row.SubCategory ?? string.Empty,
            Mode = row.Mode ?? string.Empty
        };

        // Narrow projection so pairing scans don't hydrate full entities.
        private sealed class TransferRow
        {
            public long AccountId { get; set; }
            public string BankReference { get; set; } = string.Empty;
            public string BankType { get; set; } = string.Empty;
            public string TransactionType { get; set; } = string.Empty;
            public DateTime Date { get; set; }
            public DateTime? ValueDate { get; set; }
            public decimal Debit { get; set; }
            public decimal Credit { get; set; }
            public decimal Balance { get; set; }
            public string? Mode { get; set; }
            public string? Narration { get; set; }
            public string? Description { get; set; }
            public string? UpiReference { get; set; }
            public string? UpiVpa { get; set; }
            public string? Note { get; set; }
            public string? CounterPartyName { get; set; }
            public string? CounterPartyFriendlyName { get; set; }
            public string? Category { get; set; }
            public string? SubCategory { get; set; }
            public Guid? TransferGroupId { get; set; }
        }
    }

    /// <summary>Identifies one transaction row (the entity has a composed id).</summary>
    public class TransferLegKey
    {
        public long AccountId { get; set; }
        public string BankReference { get; set; } = string.Empty;
        public string BankType { get; set; } = string.Empty;
        public string TransactionType { get; set; } = string.Empty;
    }

    public class TransferLegView
    {
        public long AccountId { get; set; }
        public string AccountName { get; set; } = string.Empty;
        public string BankReference { get; set; } = string.Empty;
        public string BankType { get; set; } = string.Empty;
        public string TransactionType { get; set; } = string.Empty;
        public DateTime Date { get; set; }
        public DateTime? ValueDate { get; set; }
        // Narration when present, else description — the one-line label the cards show.
        public string Description { get; set; } = string.Empty;
        public string Mode { get; set; } = string.Empty;

        // Detail-panel fields.
        public string Narration { get; set; } = string.Empty;
        public string RawDescription { get; set; } = string.Empty;
        public decimal Amount { get; set; }
        public string Direction { get; set; } = string.Empty;
        public decimal Balance { get; set; }
        public string UpiReference { get; set; } = string.Empty;
        public string UpiVpa { get; set; } = string.Empty;
        public string Note { get; set; } = string.Empty;
        public string Merchant { get; set; } = string.Empty;
        public string Category { get; set; } = string.Empty;
        public string SubCategory { get; set; } = string.Empty;
    }

    public class TransferPairView
    {
        // Null for suggestions; set once the pair is confirmed.
        public Guid? GroupId { get; set; }
        public decimal Amount { get; set; }
        // Debit-leg date (when the money left the source account).
        public DateTime Date { get; set; }
        public int DaysApart { get; set; }
        public bool CreditPostedFirst { get; set; }
        /// <summary>"high" | "medium" | "low" — see TransferDetectionService.Score.</summary>
        public string Confidence { get; set; } = "low";
        /// <summary>Name-ish words found in both legs' text, if any.</summary>
        public List<string> SharedNames { get; set; } = new();
        public TransferLegView From { get; set; } = new();
        public TransferLegView To { get; set; } = new();
    }
}
