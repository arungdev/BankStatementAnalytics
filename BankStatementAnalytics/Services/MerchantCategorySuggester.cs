using System.Text;
using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Services
{
    /// <summary>
    /// Proposes a category/sub-category for uncategorized merchants so the user doesn't
    /// have to hand-pick one for every row. Two sources, in priority order:
    /// 1. "similar" — an already-categorized merchant of the same user whose name/alias
    ///    normalizes to the same key (personalized, learns from past decisions).
    /// 2. "rule" — a built-in keyword table for well-known Indian merchants/statement
    ///    phrases (SWIGGY, IRCTC, TNEB, "INTEREST PAID", …).
    /// Suggestions are only ever offered for review in the UI — nothing is applied here —
    /// and rule hits are constrained to categories that actually exist in the user's own
    /// taxonomy so applying one never invents a category the pickers don't show.
    /// </summary>
    public static class MerchantCategorySuggester
    {
        public sealed record Suggestion(
            int MerchantId, string Name, string? FriendlyName,
            string Category, string? SubCategory,
            string Source, string MatchedOn);

        // Keyword → taxonomy mapping. Keywords match as whole words (any of them) against
        // the merchant's name, friendly name, aliases and UPI handles. First hit wins, so
        // multi-word/specific entries must come before generic single-word ones.
        // Category/SubCategory names must match the seeded defaults in
        // UserProvisioningService.SeedDefaultCategories.
        private static readonly (string[] Keywords, string Category, string? SubCategory)[] Rules =
        {
            // Food & dining
            (new[] { "SWIGGY", "ZOMATO", "EATSURE", "DOMINOS", "DOMINO" }, "Food & Dining", "Food Delivery"),
            (new[] { "CAFE", "COFFEE", "STARBUCKS", "BARISTA", "CHAI" }, "Food & Dining", "Coffee"),
            (new[] { "BAKERY", "SWEETS", "BAKES", "CAKES" }, "Food & Dining", "Sweets & Bakery"),
            (new[] { "HOTEL", "RESTAURANT", "RESTO", "BIRYANI", "BRIYANI", "DHABA", "MESS", "CANTEEN", "TIFFIN", "EATERY", "KITCHEN", "FOODS", "KFC", "MCDONALDS", "PIZZA", "BURGER", "SUBWAY" }, "Food & Dining", "Restaurants"),

            // Transport & travel
            (new[] { "IRCTC", "RAILWAY" }, "Travel", "Train Tickets"),
            (new[] { "REDBUS", "KSRTC", "TNSTC", "MSRTC", "APSRTC", "TSRTC" }, "Travel", "Bus Tickets"),
            (new[] { "INDIGO", "SPICEJET", "AKASA", "VISTARA", "AIRASIA" }, "Travel", "Flights"),
            (new[] { "OYO", "TREEBO", "FABHOTELS" }, "Travel", "Hotels"),
            (new[] { "MAKEMYTRIP", "GOIBIBO", "YATRA", "CLEARTRIP", "IXIGO", "AGODA" }, "Travel", null),
            (new[] { "OLA", "UBER", "RAPIDO" }, "Transportation", "Cab (Ola/Uber)"),
            (new[] { "PETROL", "PETROLEUM", "FUEL", "FUELS", "HPCL", "BPCL", "IOCL", "NAYARA", "FILLING" }, "Transportation", "Fuel"),
            (new[] { "FASTAG" }, "Bills & Recharges", "FASTag Recharge"),
            (new[] { "PARKING", "TOLL", "TOLLS" }, "Transportation", "Tolls & Parking"),
            (new[] { "DMRC", "BMRCL", "CMRL", "MMRDA" }, "Transportation", "Metro"),

            // Utilities & recharges
            (new[] { "TNEB", "TANGEDCO", "BESCOM", "KSEB", "MSEDCL", "TSSPDCL", "APSPDCL", "ELECTRICITY" }, "Utilities", "Electricity"),
            (new[] { "FIBERNET", "HATHWAY", "EXCITEL", "BROADBAND", "JIOFIBER" }, "Utilities", "Internet / Broadband"),
            (new[] { "INDANE", "BHARATGAS", "LPG" }, "Utilities", "Gas / LPG"),
            (new[] { "TATAPLAY", "TATASKY", "SUNDIRECT", "D2H", "DISHTV" }, "Utilities", "DTH / Cable"),
            (new[] { "JIO", "AIRTEL", "VODAFONE", "BSNL", "RECHARGE" }, "Utilities", "Mobile Recharge"),

            // Shopping & groceries
            (new[] { "AMAZON", "FLIPKART", "MYNTRA", "AJIO", "MEESHO", "NYKAA", "SNAPDEAL", "TATACLIQ" }, "Shopping", "Online Shopping"),
            (new[] { "ZUDIO", "WESTSIDE", "PANTALOONS", "LIFESTYLE", "TEXTILES", "GARMENTS", "FASHIONS" }, "Shopping", "Clothing"),
            (new[] { "CROMA", "ELECTRONICS", "MOBILES" }, "Shopping", "Electronics"),
            (new[] { "DMART", "BIGBASKET", "BLINKIT", "ZEPTO", "INSTAMART", "JIOMART", "GROFERS", "NILGIRIS", "SPENCERS", "SUPERMARKET", "SUPERMART", "HYPERMARKET" }, "Groceries & Household", "Supermarket"),
            (new[] { "MART", "STORE", "STORES", "KIRANA", "PROVISION", "PROVISIONS", "TRADERS", "AGENCIES" }, "Groceries & Household", "Kirana Store"),
            (new[] { "VEGETABLES", "FRUITS" }, "Groceries & Household", "Vegetables & Fruits"),

            // Health
            (new[] { "PHARMACY", "PHARMA", "MEDICAL", "MEDICALS", "MEDPLUS", "NETMEDS", "PHARMEASY", "CHEMIST", "MEDICINES" }, "Health & Wellness", "Medicines / Pharmacy"),
            (new[] { "HOSPITAL", "HOSPITALS", "CLINIC", "HEALTHCARE" }, "Health & Wellness", "Hospital"),
            (new[] { "DIAGNOSTIC", "DIAGNOSTICS", "SCANS", "LABORATORY" }, "Health & Wellness", "Diagnostics / Lab"),
            (new[] { "GYM", "FITNESS", "CULTFIT" }, "Health & Wellness", "Gym & Fitness"),
            (new[] { "DENTAL" }, "Health & Wellness", "Dental"),

            // Entertainment
            (new[] { "NETFLIX", "HOTSTAR", "SPOTIFY", "SONYLIV", "ZEE5", "JIOCINEMA", "GAANA" }, "Entertainment", "Subscriptions (OTT)"),
            (new[] { "BOOKMYSHOW", "PVR", "INOX", "CINEMA", "CINEMAS", "THEATRE", "MULTIPLEX" }, "Entertainment", "Movies"),

            // Money movement & bank lines
            (new[] { "ATM", "NWD", "AWB" }, "Financial", "Cash Withdrawal"),
            (new[] { "INTEREST" }, "Income", "Interest"),
            (new[] { "SALARY" }, "Income", "Salary"),
            (new[] { "DIVIDEND" }, "Income", "Dividends"),
            (new[] { "CASHBACK", "REWARDS" }, "Income", "Cashback & Rewards"),
            (new[] { "REFUND", "REVERSAL" }, "Financial", "Refunds"),
            (new[] { "CHARGES", "CHRG", "FEE", "FEES", "PENALTY" }, "Taxes & Fees", "Bank Charges"),
            (new[] { "TDS", "GST" }, "Taxes & Fees", "Income Tax"),

            // Insurance / investments / loans
            (new[] { "LIC" }, "Insurance", "Life Insurance"),
            (new[] { "INSURANCE", "POLICY" }, "Insurance", null),
            (new[] { "ZERODHA", "UPSTOX", "SMALLCASE" }, "Investments", "Stocks"),
            (new[] { "GROWW", "KUVERA", "CAMS", "KFINTECH", "MUTUAL", "SIP" }, "Investments", "Mutual Funds / SIP"),
            (new[] { "CHIT", "CHITS" }, "Investments", "Chit Fund"),
            (new[] { "EMI", "LOAN", "LOANS", "FINSERV", "FINANCE" }, "Loans & EMIs", null),
            (new[] { "CRED" }, "Loans & EMIs", "Credit Card Payment"),

            // Education / religious
            (new[] { "SCHOOL", "COLLEGE", "UNIVERSITY", "TUITION", "COACHING", "ACADEMY", "INSTITUTE" }, "Education", null),
            (new[] { "TEMPLE", "DEVASTHANAM", "TIRUMALA", "CHURCH", "MASJID" }, "Religious & Charity", "Temple / Offerings"),
            (new[] { "CHARITABLE", "CHARITY", "FOUNDATION" }, "Religious & Charity", "Donations"),
        };

        public static List<Suggestion> Suggest(
            IReadOnlyCollection<Merchant> merchants,
            IReadOnlyCollection<Category> categories)
        {
            var suggestions = new List<Suggestion>();

            // What the user has already categorized, keyed by normalized name/alias (and a
            // trailing-digit-stripped stem so "SHOP NO 12"/"SHOP NO 14" style dupes learn
            // from each other). First writer wins — ties are arbitrary but stable.
            var learned = new Dictionary<string, (string Category, string? SubCategory, string Display)>();
            foreach (var merchant in merchants.Where(m => !string.IsNullOrWhiteSpace(m.Category)))
            {
                var display = merchant.FriendlyName ?? merchant.Name;
                foreach (var key in NormalizedKeys(merchant))
                {
                    if (!learned.ContainsKey(key))
                        learned[key] = (merchant.Category!, merchant.SubCategory, display);
                }
            }

            // Rule hits must land inside the user's own taxonomy: resolve the canonical
            // category name case-insensitively, and drop the sub-category if it doesn't
            // exist under it (rather than dropping the whole suggestion).
            var taxonomy = categories
                .GroupBy(c => c.Name.Trim(), StringComparer.OrdinalIgnoreCase)
                .ToDictionary(
                    g => g.Key,
                    g => (Canonical: g.First().Name,
                          Subs: g.SelectMany(c => c.SubCategories).Select(s => s.Name).ToList()),
                    StringComparer.OrdinalIgnoreCase);

            foreach (var merchant in merchants.Where(m => string.IsNullOrWhiteSpace(m.Category)))
            {
                // 1. Learned from a similar already-categorized merchant.
                var learnedHit = NormalizedKeys(merchant)
                    .Where(learned.ContainsKey)
                    .Select(k => learned[k])
                    .FirstOrDefault();
                if (learnedHit.Category != null)
                {
                    suggestions.Add(new Suggestion(
                        merchant.Id, merchant.Name, merchant.FriendlyName,
                        learnedHit.Category, learnedHit.SubCategory,
                        "similar", learnedHit.Display));
                    continue;
                }

                // 2. Built-in keyword rules.
                var haystack = TokenizedText(merchant);
                foreach (var (keywords, category, subCategory) in Rules)
                {
                    var matched = keywords.FirstOrDefault(k => haystack.Contains($" {k} "));
                    if (matched == null) continue;
                    // Category absent from this user's taxonomy: let a later rule try.
                    if (!taxonomy.TryGetValue(category, out var known)) continue;

                    var sub = subCategory != null
                        ? known.Subs.FirstOrDefault(s => string.Equals(s, subCategory, StringComparison.OrdinalIgnoreCase))
                        : null;
                    suggestions.Add(new Suggestion(
                        merchant.Id, merchant.Name, merchant.FriendlyName,
                        known.Canonical, sub, "rule", matched));
                    break;
                }
            }

            return suggestions;
        }

        // All the normalized identities a merchant is reachable by. Includes a
        // trailing-digit-stripped stem (min 6 chars) so serial-numbered variants match.
        private static IEnumerable<string> NormalizedKeys(Merchant merchant)
        {
            var names = new[] { merchant.Name, merchant.FriendlyName }
                .Concat(merchant.Aliases ?? Enumerable.Empty<string>());
            var seen = new HashSet<string>();
            foreach (var name in names)
            {
                var key = Normalize(name);
                if (key.Length >= 3 && seen.Add(key))
                    yield return key;
                var stem = key.TrimEnd("0123456789".ToCharArray());
                if (stem.Length >= 6 && stem != key && seen.Add(stem))
                    yield return stem;
            }
        }

        private static string Normalize(string? value)
        {
            if (string.IsNullOrWhiteSpace(value)) return string.Empty;
            var sb = new StringBuilder(value.Length);
            foreach (var ch in value)
                if (char.IsLetterOrDigit(ch))
                    sb.Append(char.ToUpperInvariant(ch));
            return sb.ToString();
        }

        // Name + friendly name + aliases + UPI handles as one space-delimited, uppercased
        // token string (padded so " KEY " tests are whole-word). UPI ids split on
        // punctuation, so "swiggy@icici" exposes the SWIGGY token.
        private static string TokenizedText(Merchant merchant)
        {
            var parts = new[] { merchant.Name, merchant.FriendlyName }
                .Concat(merchant.Aliases ?? Enumerable.Empty<string>())
                .Concat((merchant.UpiIds ?? new List<MerchantUpi>()).Select(u => u.UpiId));

            var sb = new StringBuilder(" ");
            foreach (var part in parts)
            {
                if (string.IsNullOrWhiteSpace(part)) continue;
                foreach (var ch in part)
                    sb.Append(char.IsLetterOrDigit(ch) ? char.ToUpperInvariant(ch) : ' ');
                sb.Append(' ');
            }
            return WhitespaceCollapse(sb.ToString());
        }

        private static string WhitespaceCollapse(string value)
        {
            var sb = new StringBuilder(value.Length);
            var lastWasSpace = false;
            foreach (var ch in value)
            {
                var isSpace = ch == ' ';
                if (isSpace && lastWasSpace) continue;
                sb.Append(ch);
                lastWasSpace = isSpace;
            }
            return sb.ToString();
        }
    }
}
