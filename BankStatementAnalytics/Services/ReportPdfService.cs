using System;
using System.Globalization;
using System.IO;
using System.Linq;
using MigraDoc.DocumentObjectModel;
using MigraDoc.DocumentObjectModel.Shapes.Charts;
using MigraDoc.DocumentObjectModel.Tables;
using MigraDoc.Rendering;
using PdfSharp.Fonts;

namespace BankStatementAnalytics.Services
{
    /// <summary>
    /// Renders a <see cref="ReportView"/> into a real PDF document (served by
    /// <c>api/reports/pdf</c>) so "Download PDF" produces a file instead of relying on the
    /// browser's print dialog. MigraDoc/PDFsharp is pure managed — safe for the
    /// single-file self-contained publish, same reasoning as PdfPig.
    /// </summary>
    public class ReportPdfService
    {
        static ReportPdfService()
        {
            // PDFsharp's "Core" build has no OS font access, and its optional Windows
            // resolver (UseWindowsFontsUnderWindows) fails to find "Segoe UI" — so load
            // the Segoe UI files from C:\Windows\Fonts directly. The resolver is a
            // set-once process-wide global, hence the static ctor.
            GlobalFontSettings.FontResolver = new SegoeFontResolver();
        }

        // Every family funnels to Segoe UI: it ships with Windows and covers ₹ (U+20B9).
        private sealed class SegoeFontResolver : IFontResolver
        {
            private static readonly string FontDir =
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "Fonts");

            public byte[]? GetFont(string faceName) => File.ReadAllBytes(Path.Combine(FontDir, faceName));

            public FontResolverInfo? ResolveTypeface(string familyName, bool bold, bool italic)
            {
                var file = (bold, italic) switch
                {
                    (true, true) => "segoeuiz.ttf",
                    (true, false) => "segoeuib.ttf",
                    (false, true) => "segoeuii.ttf",
                    _ => "segoeui.ttf",
                };
                return new FontResolverInfo(file);
            }
        }

        private const string FontName = "Segoe UI";

        private static readonly CultureInfo Inr = CultureInfo.GetCultureInfo("en-IN");

        // Mirrors the web app's light-theme tokens so the PDF matches the Reports page.
        private static readonly Color Indigo = new Color(0x4F, 0x46, 0xE5);
        private static readonly Color Text   = new Color(0x1F, 0x29, 0x37);
        private static readonly Color Muted  = new Color(0x6B, 0x72, 0x80);
        private static readonly Color Border = new Color(0xE5, 0xE7, 0xEB);
        private static readonly Color HeadBg = new Color(0xF3, 0xF4, 0xF6);
        private static readonly Color Red    = new Color(0xDC, 0x26, 0x26);
        private static readonly Color Green  = new Color(0x05, 0x96, 0x69);
        private static readonly Color GreenBar = new Color(0x34, 0xD3, 0x99);
        private static readonly Color RedBar   = new Color(0xF8, 0x71, 0x71);

        private static string Money(decimal v) => v.ToString("C0", Inr);

        public byte[] Render(ReportView report, string scopeLabel)
        {
            var doc = BuildDocument(report, scopeLabel);
            var renderer = new PdfDocumentRenderer { Document = doc };
            renderer.RenderDocument();
            using var ms = new MemoryStream();
            renderer.PdfDocument.Save(ms);
            return ms.ToArray();
        }

        private static Document BuildDocument(ReportView r, string scopeLabel)
        {
            var yearly = r.Type == "year";
            var doc = new Document();
            doc.Info.Title = $"{r.Label} {(yearly ? "Annual" : "Monthly")} Report";
            doc.Info.Author = "Bank Statement Analytics";

            var normal = doc.Styles[StyleNames.Normal]!;
            normal.Font.Name = FontName;
            normal.Font.Size = 9;
            normal.Font.Color = Text;

            var sec = doc.AddSection();
            sec.PageSetup.PageFormat = PageFormat.A4;
            sec.PageSetup.TopMargin = Unit.FromCentimeter(1.8);
            sec.PageSetup.BottomMargin = Unit.FromCentimeter(1.8);
            sec.PageSetup.LeftMargin = Unit.FromCentimeter(1.8);
            sec.PageSetup.RightMargin = Unit.FromCentimeter(1.8);

            // Footer: "Bank Statement Analytics        Page X of Y"
            var footer = sec.Footers.Primary.AddParagraph();
            footer.Format.Font.Size = 7.5;
            footer.Format.Font.Color = Muted;
            footer.Format.AddTabStop(Unit.FromCentimeter(17.4), TabAlignment.Right);
            footer.AddText("Bank Statement Analytics");
            footer.AddTab();
            footer.AddText("Page ");
            footer.AddPageField();
            footer.AddText(" of ");
            footer.AddNumPagesField();

            // ── Title block ──
            var title = sec.AddParagraph($"{r.Label} {(yearly ? "Annual" : "Monthly")} Report");
            title.Format.Font.Size = 17;
            title.Format.Font.Bold = true;
            title.Format.SpaceAfter = Unit.FromPoint(2);

            var sub = sec.AddParagraph(
                $"{scopeLabel} · {r.StartDate:dd MMM yyyy} – {r.EndDate:dd MMM yyyy} · Generated {DateTime.Now:dd MMM yyyy}");
            sub.Format.Font.Size = 8.5;
            sub.Format.Font.Color = Muted;
            sub.Format.SpaceAfter = Unit.FromPoint(4);

            var rule = sec.AddParagraph();
            rule.Format.SpaceAfter = Unit.FromPoint(10);
            rule.Format.Borders.Bottom = new MigraDoc.DocumentObjectModel.Border { Width = 1.5, Color = Indigo };

            // ── Summary ──
            AddSummary(sec, r.Summary);

            // ── Month-by-month (yearly only) ──
            if (yearly && r.MonthlySeries is { Count: > 0 })
            {
                AddSectionTitle(sec, "Income vs Spends by Month");
                AddMonthlyChart(sec, r);
                AddMonthlyTable(sec, r);
            }

            // ── Spend by category ──
            AddSectionTitle(sec, "Spend by Category");
            if (r.ByCategory.Count == 0)
                AddMutedLine(sec, "No spending in this period.");
            else
                AddCategoryTable(sec, r);

            // ── Top merchants ──
            AddSectionTitle(sec, "Top Merchants");
            if (r.TopMerchants.Count == 0)
                AddMutedLine(sec, "No merchant spending in this period.");
            else
                AddMerchantTable(sec, r);

            // ── Budgets ──
            if (r.Budgets.Count > 0)
            {
                AddSectionTitle(sec, yearly
                    ? "Budget Performance (all accounts, limits × months elapsed)"
                    : "Budget Performance (all accounts)");
                AddBudgetTable(sec, r);
            }

            // ── Bills ──
            if (r.Bills.Count > 0)
            {
                AddSectionTitle(sec, "Bills Paid (all accounts)");
                AddBillTable(sec, r);
            }

            // ── Deposits ──
            if (r.Deposits?.Items is { Count: > 0 })
            {
                AddSectionTitle(sec, "Deposits & Investments (all accounts)");
                AddDepositTable(sec, r);
            }

            return doc;
        }

        /* ── Building blocks ─────────────────────────────────────────────── */

        private static void AddSectionTitle(Section sec, string text)
        {
            var p = sec.AddParagraph(text);
            p.Format.Font.Size = 10.5;
            p.Format.Font.Bold = true;
            p.Format.SpaceBefore = Unit.FromPoint(16);
            p.Format.SpaceAfter = Unit.FromPoint(6);
            p.Format.KeepWithNext = true;
        }

        private static void AddMutedLine(Section sec, string text)
        {
            var p = sec.AddParagraph(text);
            p.Format.Font.Color = Muted;
        }

        private static Table NewTable(Section sec)
        {
            var t = sec.AddTable();
            t.Borders.Width = 0;
            t.Borders.Bottom.Width = 0.5;
            t.Borders.Bottom.Color = Border;
            t.Format.Font.Size = 9;
            return t;
        }

        private static void StyleHeaderRow(Row row)
        {
            row.Shading.Color = HeadBg;
            row.HeadingFormat = true; // repeats on page break
            row.Format.Font.Size = 7.5;
            row.Format.Font.Bold = true;
            row.Format.Font.Color = Muted;
            row.Height = Unit.FromPoint(16);
            row.VerticalAlignment = VerticalAlignment.Center;
        }

        private static Paragraph Cell(Row row, int i, string text)
        {
            var p = row.Cells[i].AddParagraph(text);
            row.Cells[i].VerticalAlignment = VerticalAlignment.Center;
            return p;
        }

        // The stat-card strip: four equal boxes matching the page's summary row.
        private static void AddSummary(Section sec, ReportSummary s)
        {
            var netPositive = s.Net >= 0;
            var t = sec.AddTable();
            t.Borders.Width = 0.75;
            t.Borders.Color = Border;
            for (var i = 0; i < 4; i++)
                t.AddColumn(Unit.FromCentimeter(17.4 / 4));

            var cells = new (string Label, string Value, Color color)[]
            {
                ("TOTAL INCOME", Money(s.TotalIncome), Green),
                ("TOTAL SPENDS", Money(s.TotalSpends), Red),
                ($"NET FLOW ({(netPositive ? "saved" : "overspent")})",
                    $"{(netPositive ? "+" : "−")}{Money(Math.Abs(s.Net))}", netPositive ? Green : Red),
                ("TRANSACTIONS", s.TransactionCount.ToString("N0", Inr), Text),
            };

            var row = t.AddRow();
            row.Height = Unit.FromCentimeter(1.5);
            row.VerticalAlignment = VerticalAlignment.Center;
            for (var i = 0; i < cells.Length; i++)
            {
                var label = row.Cells[i].AddParagraph(cells[i].Label);
                label.Format.Font.Size = 7;
                label.Format.Font.Bold = true;
                label.Format.Font.Color = Muted;
                label.Format.LeftIndent = Unit.FromPoint(8);
                label.Format.SpaceAfter = Unit.FromPoint(2);
                var value = row.Cells[i].AddParagraph(cells[i].Value);
                value.Format.Font.Size = 12.5;
                value.Format.Font.Bold = true;
                value.Format.Font.Color = cells[i].color;
                value.Format.LeftIndent = Unit.FromPoint(8);
            }
        }

        private static void AddMonthlyChart(Section sec, ReportView r)
        {
            var chart = sec.AddChart(ChartType.Column2D);
            chart.Width = Unit.FromCentimeter(17.4);
            chart.Height = Unit.FromCentimeter(6.5);

            var xSeries = chart.XValues.AddXSeries();
            foreach (var m in r.MonthlySeries!)
                xSeries.Add(m.Label);

            var income = chart.SeriesCollection.AddSeries();
            income.Name = "Income";
            income.FillFormat.Color = GreenBar;
            income.LineFormat.Visible = false;

            var spend = chart.SeriesCollection.AddSeries();
            spend.Name = "Spend";
            spend.FillFormat.Color = RedBar;
            spend.LineFormat.Visible = false;

            foreach (var m in r.MonthlySeries!)
            {
                income.Add((double)m.Income);
                spend.Add((double)m.Spend);
            }

            chart.XAxis.MajorTickMark = TickMarkType.None;
            chart.XAxis.LineFormat.Color = Border;
            chart.YAxis.MajorTickMark = TickMarkType.None;
            chart.YAxis.HasMajorGridlines = true;
            chart.YAxis.MajorGridlines.LineFormat.Color = Border;
            chart.YAxis.LineFormat.Visible = false;
            chart.YAxis.TickLabels.Format = "#,##0";
            chart.PlotArea.LineFormat.Visible = false;
            chart.Format.Font.Size = 7.5;
            chart.Format.Font.Color = Muted;

            var legend = chart.FooterArea.AddLegend();
            legend.LineFormat.Visible = false;
            legend.Format.Font.Size = 8;
        }

        private static void AddMonthlyTable(Section sec, ReportView r)
        {
            sec.AddParagraph().Format.SpaceAfter = Unit.FromPoint(6);
            var t = NewTable(sec);
            t.AddColumn(Unit.FromCentimeter(5.4));
            for (var i = 0; i < 3; i++)
                t.AddColumn(Unit.FromCentimeter(4)).Format.Alignment = ParagraphAlignment.Right;

            var h = t.AddRow();
            StyleHeaderRow(h);
            Cell(h, 0, "MONTH");
            Cell(h, 1, "INCOME");
            Cell(h, 2, "SPEND");
            Cell(h, 3, "NET");

            foreach (var m in r.MonthlySeries!)
            {
                var net = m.Income - m.Spend;
                var row = t.AddRow();
                Cell(row, 0, m.Label).Format.Font.Bold = true;
                Cell(row, 1, Money(m.Income));
                Cell(row, 2, Money(m.Spend));
                var p = Cell(row, 3, $"{(net >= 0 ? "+" : "−")}{Money(Math.Abs(net))}");
                p.Format.Font.Color = net >= 0 ? Green : Red;
                p.Format.Font.Bold = true;
            }
        }

        private static void AddCategoryTable(Section sec, ReportView r)
        {
            var spendTotal = r.Summary.TotalSpends;
            var t = NewTable(sec);
            t.AddColumn(Unit.FromCentimeter(8.4));
            t.AddColumn(Unit.FromCentimeter(2)).Format.Alignment = ParagraphAlignment.Right;
            t.AddColumn(Unit.FromCentimeter(4)).Format.Alignment = ParagraphAlignment.Right;
            t.AddColumn(Unit.FromCentimeter(3)).Format.Alignment = ParagraphAlignment.Right;

            var h = t.AddRow();
            StyleHeaderRow(h);
            Cell(h, 0, "CATEGORY");
            Cell(h, 1, "TXNS");
            Cell(h, 2, "SPEND");
            Cell(h, 3, "SHARE");

            foreach (var c in r.ByCategory)
            {
                var share = spendTotal > 0 ? (double)(c.Total / spendTotal) * 100 : 0;
                var row = t.AddRow();
                Cell(row, 0, c.Name).Format.Font.Bold = true;
                Cell(row, 1, c.Count.ToString("N0", Inr)).Format.Font.Color = Muted;
                var p = Cell(row, 2, Money(c.Total));
                p.Format.Font.Color = Red;
                p.Format.Font.Bold = true;
                Cell(row, 3, $"{share:0.0}%");
            }

            var total = t.AddRow();
            total.Borders.Bottom.Width = 0;
            Cell(total, 0, "TOTAL").Format.Font.Color = Muted;
            total.Cells[0].Format.Font.Size = 7.5;
            total.Cells[0].Format.Font.Bold = true;
            var tp = Cell(total, 2, Money(spendTotal));
            tp.Format.Font.Bold = true;
        }

        private static void AddMerchantTable(Section sec, ReportView r)
        {
            var t = NewTable(sec);
            t.AddColumn(Unit.FromCentimeter(1));
            t.AddColumn(Unit.FromCentimeter(10.4));
            t.AddColumn(Unit.FromCentimeter(2)).Format.Alignment = ParagraphAlignment.Right;
            t.AddColumn(Unit.FromCentimeter(4)).Format.Alignment = ParagraphAlignment.Right;

            var h = t.AddRow();
            StyleHeaderRow(h);
            Cell(h, 0, "#");
            Cell(h, 1, "MERCHANT");
            Cell(h, 2, "TXNS");
            Cell(h, 3, "TOTAL");

            var i = 1;
            foreach (var m in r.TopMerchants)
            {
                var row = t.AddRow();
                Cell(row, 0, (i++).ToString()).Format.Font.Color = Muted;
                Cell(row, 1, m.Name).Format.Font.Bold = true;
                Cell(row, 2, $"{m.Count}×").Format.Font.Color = Muted;
                Cell(row, 3, Money(m.Total)).Format.Font.Bold = true;
            }
        }

        private static void AddBudgetTable(Section sec, ReportView r)
        {
            var t = NewTable(sec);
            t.AddColumn(Unit.FromCentimeter(5.4));
            for (var i = 0; i < 4; i++)
                t.AddColumn(Unit.FromCentimeter(3)).Format.Alignment = ParagraphAlignment.Right;

            var h = t.AddRow();
            StyleHeaderRow(h);
            Cell(h, 0, "CATEGORY");
            Cell(h, 1, "BUDGET");
            Cell(h, 2, "SPENT");
            Cell(h, 3, "REMAINING");
            Cell(h, 4, "USED");

            foreach (var b in r.Budgets)
            {
                var row = t.AddRow();
                Cell(row, 0, b.Category).Format.Font.Bold = true;
                Cell(row, 1, Money(b.Limit)).Format.Font.Color = Muted;
                var spent = Cell(row, 2, Money(b.Spent));
                spent.Format.Font.Bold = true;
                if (b.OverBudget) spent.Format.Font.Color = Red;
                var rem = Cell(row, 3, Money(b.Remaining));
                rem.Format.Font.Color = b.Remaining < 0 ? Red : Green;
                // "⚠" is not in Segoe UI (renders as □) — red bold + "(over)" instead.
                var used = Cell(row, 4, $"{b.Percent:0}%{(b.OverBudget ? " (over)" : "")}");
                used.Format.Font.Bold = true;
                if (b.OverBudget) used.Format.Font.Color = Red;
            }
        }

        private static void AddBillTable(Section sec, ReportView r)
        {
            var t = NewTable(sec);
            t.AddColumn(Unit.FromCentimeter(6.2));
            t.AddColumn(Unit.FromCentimeter(2.8)).Format.Alignment = ParagraphAlignment.Right;
            t.AddColumn(Unit.FromCentimeter(2.4)).Format.Alignment = ParagraphAlignment.Right;
            t.AddColumn(Unit.FromCentimeter(3)).Format.Alignment = ParagraphAlignment.Right;
            t.AddColumn(Unit.FromCentimeter(3)).Format.Alignment = ParagraphAlignment.Right;

            var h = t.AddRow();
            StyleHeaderRow(h);
            Cell(h, 0, "BILL");
            Cell(h, 1, "EXPECTED");
            Cell(h, 2, "PAYMENTS");
            Cell(h, 3, "TOTAL PAID");
            Cell(h, 4, "LAST PAID");

            foreach (var b in r.Bills)
            {
                var row = t.AddRow();
                Cell(row, 0, b.Name).Format.Font.Bold = true;
                Cell(row, 1, Money(b.ExpectedAmount)).Format.Font.Color = Muted;
                Cell(row, 2, b.PaidCount.ToString()).Format.Font.Color = Muted;
                Cell(row, 3, Money(b.TotalPaid)).Format.Font.Bold = true;
                Cell(row, 4, b.LastPaidDate.ToString("dd MMM yyyy")).Format.Font.Color = Muted;
            }
        }

        private static void AddDepositTable(Section sec, ReportView r)
        {
            var d = r.Deposits;
            var chips = new (string Label, decimal Value)[]
            {
                ("RD Invested", d.RdInvested), ("FD Placed", d.FdPlaced), ("FD Returns", d.FdReturns),
            }.Where(c => c.Value > 0).ToList();
            if (chips.Count > 0)
            {
                var p = sec.AddParagraph(string.Join("   ·   ", chips.Select(c => $"{c.Label}: {Money(c.Value)}")));
                p.Format.Font.Size = 8.5;
                p.Format.Font.Color = Muted;
                p.Format.SpaceAfter = Unit.FromPoint(6);
            }

            var t = NewTable(sec);
            t.AddColumn(Unit.FromCentimeter(6.4));
            t.AddColumn(Unit.FromCentimeter(2));
            t.AddColumn(Unit.FromCentimeter(3)).Format.Alignment = ParagraphAlignment.Right;
            t.AddColumn(Unit.FromCentimeter(3)).Format.Alignment = ParagraphAlignment.Right;
            t.AddColumn(Unit.FromCentimeter(3)).Format.Alignment = ParagraphAlignment.Right;

            var h = t.AddRow();
            StyleHeaderRow(h);
            Cell(h, 0, "DEPOSIT");
            Cell(h, 1, "TYPE");
            Cell(h, 2, "INVESTED");
            Cell(h, 3, "RETURNS");
            Cell(h, 4, "INSTALLMENTS");

            foreach (var item in d.Items)
            {
                var row = t.AddRow();
                Cell(row, 0, item.Name).Format.Font.Bold = true;
                Cell(row, 1, item.Kind).Format.Font.Color = Muted;
                Cell(row, 2, item.Invested > 0 ? Money(item.Invested) : "—").Format.Font.Bold = item.Invested > 0;
                var ret = Cell(row, 3, item.Returns > 0 ? Money(item.Returns) : "—");
                if (item.Returns > 0) ret.Format.Font.Color = Green;
                Cell(row, 4, item.Kind == "RD" ? item.Installments.ToString() : "—").Format.Font.Color = Muted;
            }
        }
    }
}
