# BankStatementAnalytics

A personal-finance app that parses bank statement exports (HDFC, HDFC Credit Card,
IOB — CSV, text, and PDF) into structured transactions, categorizes them by
merchant, and serves trends and insights. It's an ASP.NET Core (net10.0) Web API
that serves a React (Vite) SPA, backed by a local database.

> **ℹ️ Published for reference / showcase.**
> This project's shared data-access, logging, and embedded-PostgreSQL layers live in
> **`Common.Framework`**, a **private** repository. Rather than expose that source, the
> compiled library is **vendored as a prebuilt DLL** at
> [`BankStatementAnalytics/lib/Common.Framework.dll`](BankStatementAnalytics/lib/Common.Framework.dll)
> and referenced directly — so the backend **compiles from a plain clone**, no submodule
> access required. Two things still depend on the private repo and are therefore *not*
> included: the ~150 MB embedded-PostgreSQL binary bundle (the build skips copying it when
> absent — point the app at your own PostgreSQL via `appsettings` instead), and the
> framework source itself.

## Quick start

```
cd BankStatementAnalytics
dotnet restore
dotnet build      # builds against the vendored lib/Common.Framework.dll
dotnet run        # configure a PostgreSQL connection in appsettings first
```

> Updating the vendored DLL (author only): rebuild `Common.Framework` and copy its
> `bin/Release/net8.0/Common.Framework.dll` back into `BankStatementAnalytics/lib/`.

Notes

- Uploads are saved to the `Uploads/` folder by default (git-excluded).
- Real bank statements used for parser tuning live in `samples/` (git-excluded — they contain account numbers).
- Keep secrets in environment variables or user-secrets; do not commit credentials.

## License

This project is **source-available**, licensed under the
[PolyForm Noncommercial License 1.0.0](LICENSE.md).

You are free to use, modify, and share the code **for any
noncommercial purpose** (personal projects, study, hobby use,
non-profits, education, research). **Commercial use is not
permitted** without a separate license from the author.

Note: this is *not* an OSI-approved "open source" license, because
it restricts use to noncommercial purposes. The third-party
dependencies (React, ASP.NET Core, NHibernate, etc.) and the
`Common.Framework` submodule keep their own separate licenses.
