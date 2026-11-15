using BankStatementAnalytics.EnumClass;
using BankStatementAnalytics.Services;
using BankStatementAnalytics.Services.Parser;
using BankStatementAnalytics.Services.Pdf;

void Check(bool condition, string message) { if (!condition) throw new Exception(message); Console.WriteLine("PASS " + message); }
string Row(params string[] cells) => string.Join(PdfStatementReader.CellSeparator, cells);
var parser = new SbiPdfParser();
var text = Row("09/11/2026", "09/11/2026", "DEP TFR NEFT*HDFC0000001*TEST123*TEST PERSON*BA", "-", "-", "2,000.00", "2,000.00") + "\n" +
    Row("10/11/2026", "10/11/2026", "WDL TFR UPI/DR/123456789012/TEST SHOP/BANK/test@upi", "-", "100.00", "-", "1,900.00");
var rows = parser.Parse(text, 42).ToList();
Check(rows.Count == 2 && rows.All(t => t.AccountId == 42 && t.BankType == "SBI"), "SBI rows retain account and bank");
Check(rows[0].Credit == 2000 && rows[1].Debit == 100 && rows[1].TransactionType == "DR", "explicit debit and credit columns");
Check(rows[0].PendingCounterPartyName == "TEST PERSON" && rows[1].PendingCounterPartyName == "TEST SHOP" && rows[1].UpiReference == "123456789012", "NEFT and UPI counterparties");
Check(BalanceContinuity.FindGaps(rows).Count == 0, "running balances reconcile");
Check(parser.Parse(text, 42).Select(t => t.BankReference).SequenceEqual(rows.Select(t => t.BankReference)), "references stable across reimports");
Check(parser.Parse(text.Replace("1,900.00", "1,800.00"), 42).Last().BankReference != rows.Last().BankReference, "repeated payments with different balances stay distinct");
Check(TextService.GetSupportedFormats(Bank.SBI).formats.SequenceEqual(new[] { ".pdf" }), "SBI exposes PDF upload");
try { parser.Parse(Row("10/11/2026", "10/11/2026", "TEST", "-", "-", "-", "100.00"), 42).ToList(); throw new Exception("Expected rejection"); }
catch (PdfExtractionException) { Console.WriteLine("PASS ambiguous amounts rejected"); }
if (args.Length > 0)
{
    var bytes = File.ReadAllBytes(args[0]);
    var reader = new PdfStatementReader();
    var normalized = reader.ExtractNormalizedText(bytes, Bank.SBI, Environment.GetEnvironmentVariable("SBI_TEST_PDF_PASSWORD"));
    var sample = parser.Parse(normalized, 42).ToList();
    Check(sample.Count == 2 && sample.Sum(t => t.Credit) == 2100 && sample.Sum(t => t.Debit) == 0, "sample row count and totals");
    Check(sample.Last().Balance == 2100 && BalanceContinuity.FindGaps(sample).Count == 0, "sample closing balance and continuity");
    Check(sample[0].Mode == "NEFT" && sample[1].Mode == "UPI" && sample.All(t => !string.IsNullOrEmpty(t.PendingCounterPartyName)), "sample wrapped narration and merchants");
}
