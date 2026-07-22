---
description: Add support for a new bank statement format (parser, registry, PDF profile)
---

Add support for parsing a new bank's statements end-to-end — enum, parser, registry, PDF profile, UI wiring, and verification. Extra context from the user (bank name, format, sample path — may be empty): $ARGUMENTS

You are guiding the addition of a **new bank / statement format** to BankStatementAnalytics. Work through the steps in order. **Do not start editing code until you have the Step 1 information** — ask the user for anything missing (use `AskUserQuestion` for the format + debit/credit convention, and a plain request for the sample file).

---

## How the import pipeline fits together

Understanding the flow tells you exactly where a new bank plugs in. Upload → parse → dedupe → save happens in `TextService.ExtractAsync` ([TextService.cs](BankStatementAnalytics/Services/TextService.cs#L55)):

1. The account's `BankName` (a `Bank` enum) + the uploaded file's extension → look up a `BankParserConfig` in `BankParserRegistry.Parsers`.
2. **PDF**: raw bytes are converted to normalized delimiter-separated cell rows by `PdfStatementReader.ExtractNormalizedText(bytes, bank, password)` using that bank's `PdfTableProfile`. **CSV/TXT**: the raw file text is read as-is.
3. The matched `IBankParser.Parse(text, accountId)` turns that text into `BankTransaction` objects.
4. `CounterPartyService.ResolveOrCreateBatch` resolves each transaction's `PendingCounterPartyName` to a `Merchant` in one batch.
5. Dedupe: existing rows for the account are loaded; a parsed row already present (same `BankReference|BankType`) keeps its original `UploadId` and is not counted as new. Everything is upserted via `DbHelper.SaveOrUpdateManyAsync`, which relies on `BankTransaction.Equals`/`GetHashCode`.
6. Credit-card PDFs additionally run `CaptureCardSummary` (dues, limits, due date). Ignore unless you're adding a card.

So a new bank touches: **the enum**, **a parser class**, **the registry**, **(PDF) a table profile**, and **two small UI/label spots**. Nothing else.

---

## 1. Gather the required information (mandatory before coding)

You cannot write a correct parser without all of this. Ask the user for whatever's missing.

| Info | Why it's needed |
|------|-----------------|
| **Bank name + type** (account vs credit card) | Each gets its own `Bank` enum value (e.g. `HDFC` vs `HDFCCreditCard`). Cards also carry a statement-summary block. |
| **File format(s)**: `.txt` / `.csv` / `.pdf` | Each format = its own parser class + its own registry row. A bank may support several. |
| **A real sample statement** (redacted OK) | You can't tune column boundaries, header wording, or date formats blind. **For PDF the sample is mandatory** — tune it with the Step 4 harness. |
| **Column layout, in order** | Date, Value Date, Narration/Remarks, Cheque/Ref, Debit, Credit, Balance, … plus **every header-wording variant** across statement vintages (aliases). |
| **Date format(s)** | e.g. `dd/MM/yyyy`, `dd-MM-yy`, `dd MMM yyyy`. List all that appear; parse with `DateTime.TryParseExact` + `CultureInfo.InvariantCulture`. |
| **Debit/credit convention** | Separate Debit/Credit columns? A single signed Amount column? A `DR`/`CR` marker inside the narration? This decides how you set `Amount`/`Debit`/`Credit`/`TransactionType`. |
| **Dedupe reference** | What makes a row unique. Identity is `AccountId + BankReference + BankType`. If there's no stable per-row reference number, you'll synthesize one (see `GenerateReference` below). |
| **Amount quirks** | Indian lakh separators (`1,00,000.00`), currency glyphs that OCR to stray letters (HDFC CC rupee glyph → `C`), leading `+`/`-`, amount sharing a cell with a type marker (`TRF 445.00`). |

---

## 2. Register the bank

- **Enum** — add the value in [Bank.cs](BankStatementAnalytics/EnumClass/Bank.cs). This alone makes the bank appear in the account-creation UI: `GET api/accounts/banks` enumerates the `Bank` enum ([AccountApiController.cs](BankStatementAnalytics/Controllers/Api/AccountApiController.cs#L89)), and `CreateAccount.jsx` renders whatever it returns — **no frontend code change needed**.
- **Display label** — add a `case` in `BankLabel` ([AccountApiController.cs](BankStatementAnalytics/Controllers/Api/AccountApiController.cs#L96)); the default is `null`, so without it the UI shows a blank/monogram-only tile.
- **Short type code** — `BankType` is stored in a **`varchar(10)`** column and is **part of the dedupe identity**. If the enum name is >10 chars, add a short code in [BankTypeCode.cs](BankStatementAnalytics/EnumClass/BankTypeCode.cs) (e.g. `HDFCCreditCard` → `"HDFCCC"`). ⚠️ **Never change a bank's code after real data exists — it orphans every previously imported row.**

---

## 3. Write the parser

Create a class in `BankStatementAnalytics/Services/Parser/` implementing `IBankParser`. Model it on the closest existing one:

- **`.txt` fixed-width / positional**: [HdfcTransactionParser.cs](BankStatementAnalytics/Services/Parser/HdfcTransactionParser.cs) (uses a char-column threshold to split debit vs credit), [IobOpTransactionParser.cs](BankStatementAnalytics/Services/Parser/IobOpTransactionParser.cs).
- **`.csv` / delimited**: [HdfcCreditCardParser.cs](BankStatementAnalytics/Services/Parser/HdfcCreditCardParser.cs) (detects a header row, then reads delimited fields).
- **`.pdf`**: [IobPdfParser.cs](BankStatementAnalytics/Services/Parser/IobPdfParser.cs) — parses **normalized cell rows**, split on `PdfStatementReader.CellSeparator` (`\x1F`), in the profile's column order. It does NOT see raw PDF bytes.

### Fields to populate on each `BankTransaction`

Required for a usable, dedupable row:

- `TransactionDate` (DateTime) — the posting date.
- `Description` and/or `Narration` — the raw counterparty/remark text.
- `Amount`, `Debit`, `Credit` (decimal) — set `Debit` **or** `Credit` to `Amount`, the other to `0`, aligned with the final `TransactionType`.
- `TransactionType` — `"DR"` or `"CR"`.
- `Balance` (decimal) — running balance, if the statement has one (enables `BalanceContinuity` gap warnings).
- `BankType = BankTypeCode.For(Bank.Xxx)`.
- `BankReference` — a **stable** unique-per-row key (see helper below).
- `PendingCounterPartyName` — the merchant name you extracted from the narration. It is batch-resolved to a `Merchant` after parsing. **Do not resolve merchants per row.**

Optional but commonly set: `ValueDate`, `ChequeNumber`, `UpiReference`, `UpiVpa`, `Mode`, `BankCode`, `CustomerReference`.
**Do NOT set** `AccountId` or `UploadId` — `ExtractAsync` fills those after parsing. (`ImportedOn` defaults to now.)

### Synthesizing `BankReference` when the statement has no reference number

`IobOpTransactionParser.GenerateReference(tx)` is a reusable pattern — prefer a real UPI/reference id, else hash stable fields:

```csharp
// UPI id when present, else a SHA1 hash of date|mode|amount|balance
if (!string.IsNullOrWhiteSpace(tx.UpiReference))
    return $"UPI{tx.UpiReference}";
var raw = $"{tx.AccountId}|{tx.BankType}|{tx.TransactionDate:yyyyMMdd}|{tx.Mode}|{tx.Amount}|{tx.Balance}";
var hash = Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(raw)))[..12];
return $"GEN{hash}";
```

Pick hash inputs that are **stable across re-exports** but **distinguish same-day duplicate-amount rows** (include balance, or a running index if balance is absent) — otherwise two legitimate identical-amount transactions collapse into one.

### Skeleton

```csharp
public class AcmeBankParser : IBankParser
{
    private static readonly string[] DateFormats = { "dd/MM/yyyy", "dd-MM-yyyy" };

    public IEnumerable<BankTransaction> Parse(string text, int accountId)
    {
        var transactions = new List<BankTransaction>();
        foreach (var line in text.Replace("\r", "").Split('\n'))
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            try
            {
                // For PDF parsers: var cells = line.Split(PdfStatementReader.CellSeparator);
                var tx = BuildTransaction(line, accountId);
                if (tx != null) transactions.Add(tx);
            }
            catch (Exception ex)
            {
                Log.Error($"Acme parse error on row: {line}", ex); // skip bad rows, don't abort the file
            }
        }
        BalanceContinuity.WarnOnGaps(transactions, "Acme"); // sanity-log balance jumps
        return transactions;
    }
}
```

**Robustness rules the existing parsers follow:** wrap each row in try/catch and `Log.Error` bad rows rather than throwing away the whole file; skip header/footer/summary lines explicitly (a `SkipPatterns` regex list or an `inTxSection` flag); strip `\r` and trim; log via `Common.Framework.Logging.Log`, never `Console`/`ILogger`.

---

## 4. PDF only — add a table profile

PDF text extraction is generic; per-bank tuning lives entirely in `PdfTableProfiles.For(bank)` in [PdfTableProfile.cs](BankStatementAnalytics/Services/Pdf/PdfTableProfile.cs). Add a `case` for the new bank defining:

- `Columns` — `PdfTableColumn[]` in **canonical output order** (this defines the cell order your parser reads). Each column lists **every** `HeaderAliases` wording variant (matched case-insensitively after stripping non-alphanumerics).
- `RowStartDatePattern` — regex anchored with `^`, **no trailing `$`** (the reader moves any remainder after the match into the narration cell). This is how a data row is distinguished from a wrapped continuation line.
- `DateColumnIndex`, `NarrationColumnIndex`, `AmountColumnIndexes`.
- `NarrationSpillColumnIndexes` — neighbouring columns where wrapped narration fragments can land.
- `ContinuationMode` — how date-less rows relate to data rows:
  - `AppendToPrevious` — wrapped narration sits below its row (HDFC savings).
  - `Sandwich` — narration splits one line above + one below the dated row (IOB); needs a `SandwichPendingPattern` to route the primary remark line.
  - `None` — date-less rows are page furniture; discard (HDFC credit card).
- Optional: `ContinuationExcludePattern` (footer lines that masquerade as continuations), `RowYTolerance`.

**Tune against the real sample with the dev harness** before writing the parser:

```
dotnet run -- extract-pdf <file.pdf> <BankEnumName> [password]
```

(Usage is documented at [Program.cs:24](BankStatementAnalytics/Program.cs#L24).) Iterate on aliases/column order/boundaries until every transaction row extracts cleanly with the right cells; only then write the parser against those cells. A profile with no `case` throws `NotSupportedException`.

---

## 5. Register the parser in the registry

Add one row per `(Bank, FileExt, ParserType)` to `BankParserRegistry.Parsers` ([TextService.cs](BankStatementAnalytics/Services/TextService.cs#L22)):

```csharp
new() { Bank = Bank.Acme, FileExt = ".pdf", ParserType = typeof(AcmePdfParser) },
```

- **DI is automatic** — `Program.cs` loops the registry and registers every `ParserType` as scoped. No manual `services.AddScoped`.
- The registry also drives `GetSupportedFormats`, so the account's upload file-picker `accept` filter updates automatically.
- **Optional content-sniffing**: if accounts might have no bank set, extend `FallbackDetect` ([TextService.cs](BankStatementAnalytics/Services/TextService.cs#L231)) with header markers unique to this bank. Note it runs for `.txt`/`.csv` only — a PDF with no registered parser is simply unsupported.

---

## 6. Build & verify

- `dotnet build` from `BankStatementAnalytics/`.
- Use the **verify** skill (or `dotnet run`) to launch an isolated instance, then:
  1. Create an account with the new bank.
  2. Upload the sample statement.
  3. Confirm: correct **dates**, **amounts**, **debit/credit direction**, **running balances** (no `BalanceContinuity` gap warnings in the log), and **merchant resolution** (transactions link to sensible `Merchant`s).
  4. **Re-upload the same file** → it must report **0 new** transactions (dedupe/`BankReference` is stable). This is the single best test that your reference key is correct.
- For a credit card, also confirm the statement summary (dues/limits/due date) is captured.

---

## Common pitfalls

- **Unstable `BankReference`** → re-uploads create duplicates, or distinct same-amount rows collapse. Fix the hash inputs, not the dedupe code.
- **Changing a `BankTypeCode`** after data exists orphans old rows (identity changes). Choose it once.
- **Amount cell contains a type marker or glyph** (`TRF 445.00`, `C 140.00`) → extract the number by regex (`[\d,]+\.\d{2}`), don't parse the whole cell.
- **Debit/credit column off-by-one** near the boundary in PDFs → align `Debit`/`Credit` to the *final* `TransactionType`, not raw cell position (see IobPdfParser).
- **Forgetting the `BankLabel` case** → blank bank name in the UI.
- **Throwing on a bad row** → one malformed line kills the whole import. Catch + log per row.

Report which files you added/changed and the verification result.
