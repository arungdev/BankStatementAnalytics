using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace BankStatementAnalytics.Services
{
    public sealed class SplitClusterEvaluationContext
    {
        public List<RawUpiTransaction> CreditLegs { get; set; } = new();
        public RawUpiTransaction? ParentDebit { get; set; }
        public DateTime ClusterDate { get; set; }
        public HashSet<string> OwnerNames { get; set; } = new();
        public HashSet<string> OwnerVpas { get; set; } = new();
    }

    public sealed class EvaluationResult
    {
        public int Score { get; set; }
        public string Classification { get; set; } = "Cannot Determine";
        public string Confidence { get; set; } = "Low";
        public List<string> PositiveSignals { get; set; } = new();
        public List<string> PenaltySignals { get; set; } = new();
        public decimal InferredTotal { get; set; }
        public decimal InferredUserShare { get; set; }
    }

    public static class GPaySplitScoringEngine
    {
        private static readonly Regex GPayVpaRegex = new(
            @"@ok(axis|sbi|hdfcbank|icici|google)\b",
            RegexOptions.Compiled | RegexOptions.IgnoreCase);

        private static readonly Regex SplitKeywordsRegex = new(
            @"\b(SPLIT|SHARE|CONTRIB|CONTRIBUTION|DINNER|LUNCH|FOOD|PARTY|TRIP|ROOM|RENT|BILL)\b",
            RegexOptions.Compiled | RegexOptions.IgnoreCase);

        private static readonly Regex RefundGatewayRegex = new(
            @"@(nodal|razorpay|payu|cashfree|amazonpay|billdesk)\b",
            RegexOptions.Compiled | RegexOptions.IgnoreCase);

        public static EvaluationResult Evaluate(SplitClusterEvaluationContext ctx)
        {
            var result = new EvaluationResult();
            int score = 0;

            // Minimum amount filter: Ignore micro-test transactions (e.g. ₹1.00 transfers)
            var validCredits = ctx.CreditLegs.Where(c => c.Amount > 10.00m).ToList();
            if (validCredits.Count < 2)
            {
                result.Classification = "Normal UPI Payment";
                result.Confidence = "Low";
                return result;
            }

            // ── 1. Penalty Checks (Immediate Safeguards) ────────────────────

            // Self-transfer check
            bool hasSelfTransfer = validCredits.Any(c =>
                (!string.IsNullOrWhiteSpace(c.CounterPartyName) && ctx.OwnerNames.Contains(c.CounterPartyName.Trim().ToLowerInvariant())) ||
                (!string.IsNullOrWhiteSpace(c.UpiVpa) && ctx.OwnerVpas.Contains(c.UpiVpa.Trim().ToLowerInvariant())));

            if (hasSelfTransfer)
            {
                score -= 50;
                result.PenaltySignals.Add("Self-transfer detected: sender identity matches owned account holder");
            }

            // Distinct counterparty senders check
            var distinctSenders = validCredits
                .Select(c => !string.IsNullOrWhiteSpace(c.CounterPartyName)
                    ? c.CounterPartyName.Trim().ToLowerInvariant()
                    : (c.UpiVpa.Split('@')[0].ToLowerInvariant()))
                .Where(n => !string.IsNullOrWhiteSpace(n))
                .Distinct()
                .Count();

            if (distinctSenders < 2)
            {
                score -= 40;
                result.PenaltySignals.Add("Single sender: multiple credits originate from the same individual (installment or loan repayment)");
            }

            // Refund gateway check
            bool hasRefundGateway = validCredits.Any(c => !string.IsNullOrWhiteSpace(c.UpiVpa) && RefundGatewayRegex.IsMatch(c.UpiVpa));
            if (hasRefundGateway)
            {
                score -= 50;
                result.PenaltySignals.Add("Payment gateway refund handle detected (e-commerce reversal)");
            }

            if (score < 0 && distinctSenders < 2)
            {
                result.Score = Math.Max(0, score);
                result.Classification = "Normal UPI Payment";
                result.Confidence = "Low";
                return result;
            }

            // ── 2. Positive Scoring Signals ────────────────────────────────

            // Multi-credit signal
            score += 15;
            result.PositiveSignals.Add($"{validCredits.Count} incoming credits received on {ctx.ClusterDate:dd/MM/yyyy}");

            // Verified distinct senders
            if (distinctSenders >= 2)
            {
                score += 20;
                result.PositiveSignals.Add($"{distinctSenders} verified distinct counterparty senders");
            }

            // GPay VPA handles (@ok*)
            int gpayCount = validCredits.Count(c => !string.IsNullOrWhiteSpace(c.UpiVpa) && GPayVpaRegex.IsMatch(c.UpiVpa));
            if (gpayCount == validCredits.Count)
            {
                score += 20;
                result.PositiveSignals.Add($"All {gpayCount} senders used verified Google Pay handles (@ok*)");
            }
            else if (gpayCount >= (validCredits.Count * 0.6))
            {
                score += 15;
                result.PositiveSignals.Add($"Majority ({gpayCount}/{validCredits.Count}) senders used Google Pay handles");
            }

            // Amount Equality & Symmetry
            decimal creditSum = validCredits.Sum(c => c.Amount);
            decimal avgAmount = validCredits.Average(c => c.Amount);
            bool exactEqual = validCredits.All(c => Math.Abs(c.Amount - avgAmount) <= 1.00m);

            if (exactEqual)
            {
                score += 15;
                result.PositiveSignals.Add($"Exact equal repayments: ₹{avgAmount:N2} per participant");
            }
            else
            {
                bool nearEqual = validCredits.All(c => Math.Abs(c.Amount - avgAmount) <= (avgAmount * 0.15m));
                if (nearEqual)
                {
                    score += 10;
                    result.PositiveSignals.Add("Near-equal contributions within 15% variance");
                }
            }

            // Parent Debit Match
            if (ctx.ParentDebit != null)
            {
                score += 25;
                result.PositiveSignals.Add($"Matching bill expense found: ₹{ctx.ParentDebit.Amount:N2} paid to '{ctx.ParentDebit.CounterPartyName}'");

                decimal inferredUserShare = ctx.ParentDebit.Amount - creditSum;
                result.InferredTotal = ctx.ParentDebit.Amount;
                result.InferredUserShare = inferredUserShare > 0 ? inferredUserShare : avgAmount;

                // Check clean division
                int totalHeads = validCredits.Count + 1;
                decimal expectedPerHead = ctx.ParentDebit.Amount / totalHeads;
                if (Math.Abs(avgAmount - expectedPerHead) <= 2.00m)
                {
                    score += 10;
                    result.PositiveSignals.Add($"Clean division: ₹{ctx.ParentDebit.Amount:N2} ÷ {totalHeads} participants ≈ ₹{expectedPerHead:N2} each");
                }
            }
            else
            {
                result.InferredTotal = creditSum + avgAmount;
                result.InferredUserShare = avgAmount;
            }

            // Keywords in narrations
            bool hasSplitKeywords = validCredits.Any(c => SplitKeywordsRegex.IsMatch(c.Narration));
            if (hasSplitKeywords)
            {
                score += 10;
                result.PositiveSignals.Add("Narration text contains split/bill reference keywords");
            }

            // Clamp and classify
            result.Score = Math.Clamp(score, 0, 100);

            if (result.Score >= 75)
            {
                result.Confidence = "High";
                result.Classification = "Possible Bill Split";
            }
            else if (result.Score >= 50)
            {
                result.Confidence = "Medium";
                result.Classification = ctx.ParentDebit != null ? "Possible Bill Split" : "Possible Group Payment";
            }
            else if (result.Score >= 30)
            {
                result.Confidence = "Low";
                result.Classification = "Possible Group Payment";
            }
            else
            {
                result.Confidence = "Low";
                result.Classification = "Normal UPI Payment";
            }

            return result;
        }
    }

    public sealed class RawUpiTransaction
    {
        public long AccountId { get; set; }
        public string BankReference { get; set; } = string.Empty;
        public string BankType { get; set; } = string.Empty;
        public string TransactionType { get; set; } = string.Empty;
        public DateTime Date { get; set; }
        public decimal Amount { get; set; }
        public string Direction { get; set; } = string.Empty;
        public string Narration { get; set; } = string.Empty;
        public string UpiVpa { get; set; } = string.Empty;
        public string CounterPartyName { get; set; } = string.Empty;
    }
}
