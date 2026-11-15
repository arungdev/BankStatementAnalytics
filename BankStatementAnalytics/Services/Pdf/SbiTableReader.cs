using System.Text.RegularExpressions;
using UglyToad.PdfPig;

namespace BankStatementAnalytics.Services.Pdf;

/// <summary>SBI AccountStatement export: dates, description, reference, debit, credit, balance.
/// The supplied export has image-only column titles except for Balance.</summary>
internal static class SbiTableReader
{
    private static readonly Regex Date = new(@"^\d{2}/\d{2}/\d{4}$");

    public static string Extract(PdfDocument document)
    {
        var result = new List<string>();
        foreach (var page in document.GetPages())
        {
            var words = page.GetWords().ToList();
            var dates = words.Where(w => Date.IsMatch(w.Text) && w.BoundingBox.Left < page.Width * .12)
                .OrderByDescending(w => w.BoundingBox.Bottom).ToList();
            for (int i = 0; i < dates.Count; i++)
            {
                var date = dates[i];
                double y = date.BoundingBox.Bottom;
                // Narration starts above the numeric baseline (DEP/WDL TFR).
                double top = y + 11;
                double bottom = i + 1 < dates.Count ? dates[i + 1].BoundingBox.Bottom + 11 : y - 42;
                var row = words.Where(w => w.BoundingBox.Bottom <= top && w.BoundingBox.Bottom > bottom).ToList();
                var cells = new string[7];
                cells[0] = date.Text;
                cells[1] = string.Join(" ", row.Where(w => w.BoundingBox.Left >= page.Width * .12 && w.BoundingBox.Left < page.Width * .22 && Date.IsMatch(w.Text)).Select(w => w.Text));
                cells[2] = string.Join(" ", row.Where(w => w.BoundingBox.Left >= page.Width * .22 && w.BoundingBox.Left < page.Width * .47)
                    .OrderByDescending(w => Math.Round(w.BoundingBox.Bottom / 3)).ThenBy(w => w.BoundingBox.Left).Select(w => w.Text));
                // Amounts and reference share the date baseline; narration wraps below it.
                var baseline = row.Where(w => Math.Abs(w.BoundingBox.Bottom - y) < 2).ToList();
                double[] edges = { .47, .56, .67, .81, 1.0 };
                for (int col = 3; col < 7; col++)
                    cells[col] = string.Join(" ", baseline.Where(w => w.BoundingBox.Left >= page.Width * edges[col - 3] && w.BoundingBox.Left < page.Width * edges[col - 2]).OrderBy(w => w.BoundingBox.Left).Select(w => w.Text));
                result.Add(string.Join(PdfStatementReader.CellSeparator, cells));
            }
        }
        if (result.Count == 0) throw new PdfTableNotFoundException("(no SBI account statement rows found)");
        return string.Join('\n', result);
    }
}
