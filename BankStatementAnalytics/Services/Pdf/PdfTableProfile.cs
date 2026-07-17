using System.Text.RegularExpressions;
using BankStatementAnalytics.EnumClass;

namespace BankStatementAnalytics.Services.Pdf
{
    /// <summary>One column of a bank's PDF transaction table.</summary>
    public class PdfTableColumn
    {
        public required string Name { get; init; }

        /// <summary>
        /// Header texts that identify this column, matched case-insensitively
        /// after stripping non-alphanumerics ("Chq./Ref.No." == "chq ref no").
        /// List every wording variant seen across statement vintages.
        /// </summary>
        public required string[] HeaderAliases { get; init; }
    }

    /// <summary>How date-less text rows relate to the data rows around them.</summary>
    public enum PdfContinuationMode
    {
        /// <summary>Wrapped narration continues BELOW its data row (HDFC savings).</summary>
        AppendToPrevious,

        /// <summary>
        /// The narration cell is vertically centered on a tall logical row, so it
        /// splits into one line ABOVE the data row and one BELOW (IOB): the first
        /// date-less row after a data row appends to it, later ones are held and
        /// prepended to the next data row.
        /// </summary>
        Sandwich,

        /// <summary>Date-less rows are always page furniture — discard them.</summary>
        None,
    }

    /// <summary>
    /// Per-bank tuning data for PDF table extraction. This is the ONLY thing
    /// that should need editing when a bank's PDF layout changes — the
    /// extraction algorithm in <see cref="PdfStatementReader"/> is generic.
    /// </summary>
    public class PdfTableProfile
    {
        public Bank Bank { get; init; }

        /// <summary>Columns in canonical output order (defines the normalized-row cell order).</summary>
        public required PdfTableColumn[] Columns { get; init; }

        /// <summary>
        /// A row is a data row when its date cell STARTS with this pattern
        /// (anchor with ^, no trailing $ — any remainder after the match is
        /// moved into the narration cell by the reader).
        /// </summary>
        public required Regex RowStartDatePattern { get; init; }

        /// <summary>Max vertical distance (pt) between word baselines in the same visual row.</summary>
        public double RowYTolerance { get; init; } = 2.5;

        public int DateColumnIndex { get; init; } = 0;

        /// <summary>Continuation rows (wrapped text) get appended to this cell of the previous row.</summary>
        public int NarrationColumnIndex { get; init; } = 1;

        /// <summary>Cells that must ALL be empty for a row to count as a narration continuation.</summary>
        public int[] AmountColumnIndexes { get; init; } = Array.Empty<int>();

        /// <summary>
        /// Columns adjacent to the narration whose content on a DATE-LESS row is
        /// really narration spill-over: short wrapped fragments can have their
        /// word center fall just across the header-derived boundary and land in
        /// a neighbouring cell ("R/CNR/tkt" in the CHQ column). Their text is
        /// joined into the continuation fragment in column order.
        /// </summary>
        public int[] NarrationSpillColumnIndexes { get; init; } = Array.Empty<int>();

        public PdfContinuationMode ContinuationMode { get; init; } = PdfContinuationMode.AppendToPrevious;

        /// <summary>
        /// Fragments matching this pattern are page furniture even when they
        /// look like a narration continuation (e.g. the "HDFC BANK LIMITED"
        /// footer line that directly follows the last transaction of a page).
        /// Matching rows are discarded and close the append window.
        /// </summary>
        public Regex? ContinuationExcludePattern { get; init; }

        /// <summary>
        /// Sandwich mode only: fragments matching this pattern are the PRIMARY
        /// remark line and belong to the NEXT data row; everything else trails
        /// the previous one. Content routing is needed because a transaction
        /// with a single-line remark has no trailing fragment — a positional
        /// "first fragment after a row trails it" rule would steal the next
        /// transaction's remark.
        /// </summary>
        public Regex? SandwichPendingPattern { get; init; }
    }

    public static class PdfTableProfiles
    {
        // Initial column layouts are educated guesses from the banks' e-statement
        // formats; tune aliases/order against real sample PDFs via the dev harness:
        //   dotnet run -- extract-pdf <file.pdf> <HDFC|IOB|HDFCCreditCard> [password]

        public static PdfTableProfile For(Bank bank) => bank switch
        {
            Bank.HDFC => new PdfTableProfile
            {
                Bank = Bank.HDFC,
                Columns = new PdfTableColumn[]
                {
                    new() { Name = "Date",       HeaderAliases = new[] { "Date" } },
                    new() { Name = "Narration",  HeaderAliases = new[] { "Narration" } },
                    new() { Name = "Ref",        HeaderAliases = new[] { "Chq./Ref.No.", "Chq/Ref Number", "Chq./Ref No", "Ref No", "Cheque/Ref No" } },
                    new() { Name = "ValueDate",  HeaderAliases = new[] { "Value Dt", "Value Date" } },
                    new() { Name = "Withdrawal", HeaderAliases = new[] { "Withdrawal Amt.", "Withdrawal Amt", "Withdrawal", "Debit Amount" } },
                    new() { Name = "Deposit",    HeaderAliases = new[] { "Deposit Amt.", "Deposit Amt", "Deposit", "Credit Amount" } },
                    new() { Name = "Balance",    HeaderAliases = new[] { "Closing Balance", "Balance" } },
                },
                RowStartDatePattern = new Regex(@"^\d{2}/\d{2}/\d{2,4}\b", RegexOptions.Compiled),
                DateColumnIndex = 0,
                NarrationColumnIndex = 1,
                AmountColumnIndexes = new[] { 4, 5, 6 },
                // Narration text begins LEFT of the "Narration" header and wraps
                // continuation lines whose first/last words land in the Date and
                // Ref cells ("- ADMINWARE|SOFTWARE PRIVATE LIMITED|-").
                NarrationSpillColumnIndexes = new[] { 0, 2 },
                // Page footer line that directly follows the last row of a page
                // and would otherwise pass the continuation checks.
                ContinuationExcludePattern = new Regex(@"^HDFC BANK LIMITED$", RegexOptions.Compiled),
            },

            // Layout measured from a real Jul-2026 e-statement. Header:
            //   Date | Value Date | CHQ | Remarks | COD | Debit | Credit | Balance
            // COD carries the "TRF" transaction marker; remarks wrap one line
            // above and one line below the dated row (hence Sandwich mode).
            Bank.IOB => new PdfTableProfile
            {
                Bank = Bank.IOB,
                Columns = new PdfTableColumn[]
                {
                    new() { Name = "Date",      HeaderAliases = new[] { "Date", "Txn Date", "Transaction Date" } },
                    new() { Name = "ValueDate", HeaderAliases = new[] { "Value Date" } },
                    new() { Name = "Chq",       HeaderAliases = new[] { "CHQ", "Chq No", "Cheque No" } },
                    new() { Name = "Remarks",   HeaderAliases = new[] { "Remarks", "Particulars", "Narration", "Description" } },
                    new() { Name = "Cod",       HeaderAliases = new[] { "COD" } },
                    new() { Name = "Debit",     HeaderAliases = new[] { "Debit", "Withdrawal" } },
                    new() { Name = "Credit",    HeaderAliases = new[] { "Credit", "Deposit" } },
                    new() { Name = "Balance",   HeaderAliases = new[] { "Balance", "Closing Balance" } },
                },
                RowStartDatePattern = new Regex(@"^\d{2}[/-]\d{2}[/-]\d{4}\b", RegexOptions.Compiled),
                DateColumnIndex = 0,
                NarrationColumnIndex = 3,
                AmountColumnIndexes = new[] { 5, 6, 7 },
                NarrationSpillColumnIndexes = new[] { 2, 4 }, // CHQ and COD flank the remarks
                ContinuationMode = PdfContinuationMode.Sandwich,
                // Primary remark heads (cf. OpTransactionParser.KeywordRegex, but
                // stricter: "UPI/" alone would false-match trailing fragments like
                // "UPI/YES/Oid100006" — requiring digits after "UPI/" does not).
                // "UPI/CR/<digits>" is the bank-side refund form; "SMS ALERT" is a
                // bank-charge remark.
                SandwichPendingPattern = new Regex(@"UPI/\d+|UPI/(CR|DR)/\d+|-ATM-|NEFT|CASH|ECOM|CHRGS|Int\.Pd|SMS ALERT",
                    RegexOptions.Compiled),
            },

            // Layout measured from a real Jun-2026 billed e-statement:
            //   DATE & TIME | TRANSACTION DESCRIPTION | REWARDS | AMOUNT | PI
            // Date cells render as "08/06/2026| 19:29"; amounts as "C 140.00"
            // (the rupee glyph extracts as "C"); credits carry a "+" marker.
            Bank.HDFCCreditCard => new PdfTableProfile
            {
                Bank = Bank.HDFCCreditCard,
                Columns = new PdfTableColumn[]
                {
                    new() { Name = "Date",        HeaderAliases = new[] { "DATE & TIME", "Date & Time", "Date", "Transaction Date" } },
                    new() { Name = "Description", HeaderAliases = new[] { "TRANSACTION DESCRIPTION", "Description", "Transaction Details" } },
                    new() { Name = "Rewards",     HeaderAliases = new[] { "REWARDS", "Feature Reward Points" } },
                    new() { Name = "Amount",      HeaderAliases = new[] { "AMOUNT", "Amount (in Rs.)", "Amount (Rs.)" } },
                    new() { Name = "PI",          HeaderAliases = new[] { "PI" } },
                },
                RowStartDatePattern = new Regex(@"^\d{2}/\d{2}/\d{4}\|?(\s+\d{2}:\d{2}(:\d{2})?)?", RegexOptions.Compiled),
                DateColumnIndex = 0,
                NarrationColumnIndex = 1,
                AmountColumnIndexes = new[] { 3 },
                // Footers/summaries share the description column on this layout;
                // continuations would glue them onto real rows.
                ContinuationMode = PdfContinuationMode.None,
            },

            _ => throw new NotSupportedException($"No PDF table profile registered for bank: {bank}"),
        };
    }
}
