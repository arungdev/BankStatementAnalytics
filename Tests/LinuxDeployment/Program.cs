using BankStatementAnalytics.Services;

var report = new ReportView
{
    Type = "monthly",
    Label = "Linux deployment ₹ report",
    StartDate = new DateTime(2026, 1, 1),
    EndDate = new DateTime(2026, 1, 31),
    Summary = new ReportSummary { TotalIncome = 2000, TotalSpends = 500, Net = 1500, TransactionCount = 2 },
    ByCategory = new() { new ReportGroupTotal { Name = "Bills", Total = 500, Count = 1 } }
};
var pdf = new ReportPdfService().Render(report, "Test account");
if (pdf.Length < 1000 || System.Text.Encoding.ASCII.GetString(pdf, 0, 5) != "%PDF-")
    throw new Exception("Report export did not produce a PDF.");
Console.WriteLine($"PASS: report PDF rendered with platform fonts ({pdf.Length} bytes)");
