# BankStatementAnalytics

This is a Razor/ASP.NET Core project for parsing bank statements.

Quick start

1. dotnet restore
2. dotnet build
3. dotnet run

Notes

- Uploads are saved to the Uploads/ folder by default; add to .gitignore (already excluded).
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
