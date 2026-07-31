using System.Text;
using System.Text.RegularExpressions;
using BankStatementAnalytics.EnumClass;
using UglyToad.PdfPig;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Exceptions;

namespace BankStatementAnalytics.Services.Pdf
{
    /// <summary>
    /// Extracts a bank's transaction table from a digitally-generated statement
    /// PDF into normalized text: one logical row per line, cells joined by
    /// <see cref="CellSeparator"/> in the profile's canonical column order.
    ///
    /// Algorithm: words are clustered into visual rows by baseline Y; the header
    /// row is located by matching the profile's column aliases; column X
    /// boundaries are the midpoints between adjacent header cells; every word is
    /// then assigned to a column by its X center. Rows whose date cell matches
    /// the profile's date pattern are data rows; date-less rows with empty
    /// amount cells are wrapped-narration continuations; everything else is
    /// page furniture and discarded. Failures throw typed
    /// <see cref="PdfExtractionException"/>s with user-facing messages.
    /// </summary>
    public class PdfStatementReader
    {
        public const char CellSeparator = '\x1F';

        private static readonly Regex NonAlphaNum = new(@"[^a-z0-9]", RegexOptions.Compiled);

        /// <summary>
        /// The columns actually printed by the statement at hand, in left-to-right
        /// order: <see cref="Boundaries"/> are the N-1 split Xs between them and
        /// <see cref="ColumnIndexes"/> maps each slot back to its profile column,
        /// so optional columns the statement omits stay empty in the output row.
        /// </summary>
        private sealed class ColumnLayout
        {
            public required double[] Boundaries { get; init; }
            public required int[] ColumnIndexes { get; init; }
        }

        // ── Public API ────────────────────────────────────────────────

        /// <summary>
        /// Cheap pre-flight: verifies the PDF opens (password ok) and has a text
        /// layer. Called by the upload endpoint BEFORE any DB row is written.
        /// </summary>
        public void Validate(byte[] pdfBytes, string? password)
        {
            using var doc = OpenDocument(pdfBytes, password);
            EnsureTextLayer(doc);
        }

        public string ExtractNormalizedText(byte[] pdfBytes, Bank bank, string? password)
        {
            var profile = PdfTableProfiles.For(bank);
            using var doc = OpenDocument(pdfBytes, password);
            EnsureTextLayer(doc);

            var outputRows = new List<string[]>();
            ColumnLayout? layout = null; // column geometry from the most recent header

            // Continuation state (see PdfContinuationMode). Kept across pages:
            // a narration fragment can sit at a page bottom with its data row on
            // the next page.
            string? pendingNarration = null;   // Sandwich: held for the NEXT data row
            bool appendSlotOpen = false;       // Sandwich: next date-less row belongs to the LAST data row
            bool appendWindowOpen = false;     // AppendToPrevious: furniture (SKIP) rows close it

            foreach (var page in doc.GetPages())
            {
                var rows = GroupIntoRows(page.GetWords(), profile.RowYTolerance);

                for (int i = 0; i < rows.Count; i++)
                {
                    // Header rows re-anchor the column boundaries (repeated per page).
                    if (TryDetectHeader(rows, ref i, profile, out var newLayout))
                    {
                        layout = newLayout;
                        continue;
                    }

                    if (layout == null) continue; // furniture before the first header

                    var cells = AssignCells(rows[i], layout, profile.Columns.Length);
                    ClassifyAndAppend(cells, profile, outputRows,
                        ref pendingNarration, ref appendSlotOpen, ref appendWindowOpen);
                }
            }

            if (layout == null)
                throw new PdfTableNotFoundException(
                    $"(no header row matched the {profile.Bank} column profile)");
            if (outputRows.Count == 0)
                throw new PdfTableNotFoundException(
                    $"(header found, but no data rows matched the {profile.Bank} date pattern)");

            var sb = new StringBuilder();
            foreach (var row in outputRows)
                sb.Append(string.Join(CellSeparator, row)).Append('\n');
            return sb.ToString();
        }

        /// <summary>
        /// Debug/tuning aid: every row with its assigned cells and how it would
        /// classify (HEADER/DATA/CONT/SKIP), so boundary problems are visible.
        /// Used by the extract-pdf harness via the --cells flag.
        /// </summary>
        public IEnumerable<string> DumpAssignedCells(byte[] pdfBytes, Bank bank, string? password)
        {
            var profile = PdfTableProfiles.For(bank);
            using var doc = OpenDocument(pdfBytes, password);

            ColumnLayout? layout = null;
            int pageNo = 0;

            foreach (var page in doc.GetPages())
            {
                yield return $"───── page {++pageNo} ─────";
                var rows = GroupIntoRows(page.GetWords(), profile.RowYTolerance);

                for (int i = 0; i < rows.Count; i++)
                {
                    if (TryDetectHeader(rows, ref i, profile, out var l))
                    {
                        layout = l;
                        yield return
                            $"HEADER  columns: {string.Join(", ", l.ColumnIndexes.Select(c => profile.Columns[c].Name))}" +
                            $"  boundaries: {string.Join(", ", l.Boundaries.Select(x => x.ToString("0.0")))}";
                        continue;
                    }

                    if (layout == null) continue;

                    var cells = AssignCells(rows[i], layout, profile.Columns.Length);
                    var dm = profile.RowStartDatePattern.Match(cells[profile.DateColumnIndex]);
                    string verdict =
                        dm.Success && dm.Index == 0 ? "DATA"
                        : cells[profile.DateColumnIndex].Length == 0 &&
                          profile.AmountColumnIndexes.All(a => cells[a].Length == 0) &&
                          cells[profile.NarrationColumnIndex].Length > 0 ? "CONT"
                        : "SKIP";
                    yield return $"{verdict,-6}{string.Join('|', cells)}";
                }
            }
        }

        /// <summary>
        /// Debug/tuning aid: every visual row of the document as plain text
        /// (words joined by spaces, page breaks marked). Used by the
        /// extract-pdf harness with bank "RAW" to inspect a statement's real
        /// header wording and row shapes before editing PdfTableProfiles.
        /// </summary>
        public IEnumerable<string> DumpVisualRows(byte[] pdfBytes, string? password)
        {
            using var doc = OpenDocument(pdfBytes, password);
            int pageNo = 0;
            foreach (var page in doc.GetPages())
            {
                yield return $"───── page {++pageNo} ─────";
                foreach (var row in GroupIntoRows(page.GetWords(), 2.5))
                    yield return string.Join(' ', row.Select(w => w.Text));
            }
        }

        // ── Document opening / validation ─────────────────────────────

        private static PdfDocument OpenDocument(byte[] bytes, string? password)
        {
            try
            {
                var options = new ParsingOptions();
                if (!string.IsNullOrEmpty(password))
                    options.Password = password;
                return PdfDocument.Open(bytes, options);
            }
            catch (PdfDocumentEncryptedException)
            {
                if (string.IsNullOrEmpty(password))
                    throw new PdfPasswordRequiredException();
                throw new PdfWrongPasswordException();
            }
            catch (PdfExtractionException)
            {
                throw;
            }
            catch (Exception ex)
            {
                throw new PdfExtractionException(
                    "The file could not be read as a PDF — it may be corrupted or not a real PDF.", ex);
            }
        }

        private static void EnsureTextLayer(PdfDocument doc)
        {
            foreach (var page in doc.GetPages())
                if (page.Letters.Count > 0)
                    return;
            throw new PdfNoTextLayerException();
        }

        // ── Row clustering ────────────────────────────────────────────

        /// <summary>
        /// Groups words into visual rows by baseline Y (PDF Y grows upward, so
        /// rows are emitted top-of-page first). Words within a row are sorted
        /// left-to-right.
        /// </summary>
        private static List<List<Word>> GroupIntoRows(IEnumerable<Word> words, double yTolerance)
        {
            var rows = new List<List<Word>>();

            foreach (var word in words.OrderByDescending(w => w.BoundingBox.Bottom))
            {
                if (string.IsNullOrWhiteSpace(word.Text)) continue;

                var current = rows.Count > 0 ? rows[^1] : null;
                if (current != null &&
                    Math.Abs(current[0].BoundingBox.Bottom - word.BoundingBox.Bottom) <= yTolerance)
                {
                    current.Add(word);
                }
                else
                {
                    rows.Add(new List<Word> { word });
                }
            }

            foreach (var row in rows)
                row.Sort((a, b) => a.BoundingBox.Left.CompareTo(b.BoundingBox.Left));

            return rows;
        }

        // ── Header detection ──────────────────────────────────────────

        /// <summary>
        /// Tries to match the profile's columns against the row at index <paramref name="i"/>.
        /// Some banks stack the header over two visual lines ("Withdrawal" / "Amt."),
        /// so when the single row matches at least two columns but not all, the next
        /// row's words are merged in and matching is retried (consuming both rows).
        /// On success, outputs the layout of the columns this statement prints and
        /// advances <paramref name="i"/> past consumed rows.
        /// </summary>
        private static bool TryDetectHeader(
            List<List<Word>> rows, ref int i, PdfTableProfile profile, out ColumnLayout layout)
        {
            layout = null!;

            var spans = MatchColumns(rows[i], profile);
            if (spans != null && BuildLayout(spans, out layout))
                return true;

            // Two-line header attempt: merge with the following row.
            if (i + 1 < rows.Count && CountMatchedColumns(rows[i], profile) >= 2)
            {
                var merged = rows[i].Concat(rows[i + 1])
                    .OrderBy(w => w.BoundingBox.Left).ToList();
                spans = MatchColumns(merged, profile);
                if (spans != null && BuildLayout(spans, out layout))
                {
                    i++; // consume the second header line too
                    return true;
                }
            }

            return false;
        }

        /// <summary>
        /// Matches every profile column against the row's words. Returns one
        /// (left, right) X span per column — null for optional columns this
        /// statement omits — or null overall when a required column is missing.
        /// Longer aliases are matched first and each word is consumed by at most
        /// one column, so "Value Date" cannot double-claim the "Date" column.
        /// </summary>
        private static (double Left, double Right)?[]? MatchColumns(List<Word> row, PdfTableProfile profile)
        {
            var spans = new (double Left, double Right)?[profile.Columns.Length];
            var consumed = new bool[row.Count];

            foreach (var (column, index) in profile.Columns
                         .Select((c, idx) => (c, idx))
                         .OrderByDescending(p => p.c.HeaderAliases.Max(a => Normalize(a).Length)))
            {
                spans[index] = MatchAliasSpan(row, consumed, column.HeaderAliases);
                if (spans[index] == null && !column.Optional) return null;
            }

            return spans;
        }

        private static int CountMatchedColumns(List<Word> row, PdfTableProfile profile)
        {
            var consumed = new bool[row.Count];
            return profile.Columns.Count(c => MatchAliasSpan(row, consumed, c.HeaderAliases) != null);
        }

        /// <summary>
        /// Finds a consecutive run of unconsumed words whose concatenated
        /// normalized text equals one of the aliases (normalized). Marks the
        /// matched words consumed and returns their X span.
        /// </summary>
        private static (double Left, double Right)? MatchAliasSpan(
            List<Word> row, bool[] consumed, string[] aliases)
        {
            var targets = aliases.Select(Normalize).Where(a => a.Length > 0).ToArray();

            for (int start = 0; start < row.Count; start++)
            {
                if (consumed[start]) continue;

                var concat = new StringBuilder();
                for (int end = start; end < row.Count && end - start < 6; end++)
                {
                    if (consumed[end]) break;
                    concat.Append(Normalize(row[end].Text));

                    if (targets.Contains(concat.ToString()))
                    {
                        for (int k = start; k <= end; k++) consumed[k] = true;
                        return (row[start].BoundingBox.Left, row[end].BoundingBox.Right);
                    }
                }
            }

            return null;
        }

        private static string Normalize(string s) =>
            NonAlphaNum.Replace(s.ToLowerInvariant(), string.Empty);

        /// <summary>
        /// Converts the matched header spans into the split Xs between adjacent
        /// printed columns (midpoints), skipping optional columns this statement
        /// omits. Rejects the match when the spans are not strictly left-to-right
        /// in profile order — that means a false-positive header.
        /// </summary>
        private static bool BuildLayout((double Left, double Right)?[] spans, out ColumnLayout layout)
        {
            layout = null!;

            var present = spans
                .Select((s, idx) => (Span: s, Index: idx))
                .Where(p => p.Span != null)
                .Select(p => (p.Span!.Value, p.Index))
                .ToArray();

            if (present.Length < 2) return false;

            var boundaries = new double[present.Length - 1];
            for (int i = 0; i < present.Length - 1; i++)
            {
                var (span, _) = present[i];
                var (next, _) = present[i + 1];
                double a = (span.Left + span.Right) / 2;
                double b = (next.Left + next.Right) / 2;
                if (b <= a) return false;
                boundaries[i] = (span.Right + next.Left) / 2;
            }

            layout = new ColumnLayout
            {
                Boundaries = boundaries,
                ColumnIndexes = present.Select(p => p.Index).ToArray(),
            };
            return true;
        }

        // ── Cell assignment / row classification ──────────────────────

        private static string[] AssignCells(List<Word> row, ColumnLayout layout, int columnCount)
        {
            var cells = new StringBuilder[columnCount];
            for (int i = 0; i < columnCount; i++) cells[i] = new StringBuilder();

            foreach (var word in row)
            {
                double center = (word.BoundingBox.Left + word.BoundingBox.Right) / 2;
                int slot = 0;
                while (slot < layout.Boundaries.Length && center >= layout.Boundaries[slot]) slot++;

                int col = layout.ColumnIndexes[slot];
                if (cells[col].Length > 0) cells[col].Append(' ');
                cells[col].Append(word.Text);
            }

            return cells.Select(c => c.ToString().Trim()).ToArray();
        }

        private static void ClassifyAndAppend(
            string[] cells, PdfTableProfile profile, List<string[]> outputRows,
            ref string? pendingNarration, ref bool appendSlotOpen, ref bool appendWindowOpen)
        {
            int narrIdx = profile.NarrationColumnIndex;
            string dateCell = cells[profile.DateColumnIndex];

            // Data row: the date cell STARTS with the date. It may carry more —
            // some layouts render date + first narration words as one text run
            // ("01/01/26 UPI-ARUN"), which lands entirely in the date cell — so
            // any remainder is pushed into the narration cell.
            var dateMatch = profile.RowStartDatePattern.Match(dateCell);
            if (dateMatch.Success && dateMatch.Index == 0)
            {
                string remainder = dateCell[dateMatch.Length..].Trim();
                cells[profile.DateColumnIndex] = dateMatch.Value.Trim();
                if (remainder.Length > 0)
                    cells[narrIdx] = (remainder + " " + cells[narrIdx]).Trim();

                if (pendingNarration != null)
                {
                    cells[narrIdx] = (pendingNarration + " " + cells[narrIdx]).Trim();
                    pendingNarration = null;
                }
                outputRows.Add(cells);
                appendSlotOpen = profile.ContinuationMode == PdfContinuationMode.Sandwich;
                appendWindowOpen = true;
                return;
            }

            // Continuation candidate: all amount cells empty, and text only in
            // the narration cell and its declared spill columns. The date cell
            // blocks unless the profile declares it as a spill column (HDFC
            // continuations start LEFT of the date/narration boundary).
            string fragment = string.Join(" ",
                profile.NarrationSpillColumnIndexes.Append(narrIdx)
                    .Distinct()
                    .OrderBy(i => i)
                    .Select(i => cells[i])
                    .Where(c => c.Length > 0));

            bool dateCellBlocks = dateCell.Length > 0 &&
                !profile.NarrationSpillColumnIndexes.Contains(profile.DateColumnIndex);

            bool isNarrationOnly =
                !dateCellBlocks &&
                profile.AmountColumnIndexes.All(a => cells[a].Length == 0) &&
                fragment.Length > 0;

            if (!isNarrationOnly ||
                (profile.ContinuationExcludePattern?.IsMatch(fragment) ?? false))
            {
                // Footers, totals, marketing — discard, and close the append
                // window so stray text after page furniture (e.g. the next
                // page's preamble) can't glue onto the last transaction.
                appendWindowOpen = false;
                return;
            }

            switch (profile.ContinuationMode)
            {
                // Window closed (furniture seen since the last data row): a
                // fragment here is stray page text, not a wrapped narration.
                case PdfContinuationMode.AppendToPrevious when outputRows.Count > 0 && appendWindowOpen:
                    AppendToRow(outputRows[^1], narrIdx, fragment);
                    break;

                case PdfContinuationMode.Sandwich:
                    // Prefer content routing (see SandwichPendingPattern); fall back
                    // to the positional first-fragment-trails rule without one.
                    bool belongsToNext = profile.SandwichPendingPattern != null
                        ? profile.SandwichPendingPattern.IsMatch(fragment)
                        : !appendSlotOpen;

                    if (!belongsToNext && outputRows.Count > 0)
                    {
                        AppendToRow(outputRows[^1], narrIdx, fragment);
                        appendSlotOpen = false;
                    }
                    else if (belongsToNext)
                    {
                        pendingNarration = pendingNarration == null
                            ? fragment
                            : pendingNarration + " " + fragment;
                    }
                    // trailing fragment before any data row: page furniture, discard
                    break;

                // PdfContinuationMode.None: discard.
            }
        }

        private static void AppendToRow(string[] row, int narrIdx, string fragment) =>
            row[narrIdx] = (row[narrIdx] + " " + fragment).Trim();
    }
}
