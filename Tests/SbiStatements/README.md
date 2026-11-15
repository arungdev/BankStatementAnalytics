# SBI statement support

SBI accounts support password-protected PDF account statements with transaction date, value date, description, reference, debit, credit and balance columns. The AccountStatement export uses image-only headings; extraction uses the measured column positions of that layout. Other SBI layouts may require a separate profile.

Run the synthetic checks:

```powershell
dotnet run --project Tests/SbiStatements -p:NuGetAudit=false
```

To verify the original two-credit sample as well, set `SBI_TEST_PDF_PASSWORD` in the process environment and pass the local PDF path as the program argument. The sample and password are not committed. This test does not import records or create accounts.
