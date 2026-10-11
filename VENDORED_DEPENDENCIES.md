# Vendored dependencies

The backend uses `BankStatementAnalytics/lib/Common.Framework.dll`; the frontend
uses the generated `Client/vendor/common-client` bundle. Both are built in private
repositories and committed so a public clone can compile without those sources.

`vendor-manifest.json` records the exact SHA-256 of the backend DLL and frontend
runtime assets. CI verifies these hashes with `node scripts/verify-vendor.mjs`.
The original source revisions are currently unknown; checksums establish artifact
identity, not independent source reproducibility.

When updating either library:

1. Build in its source repository using its documented release command.
2. Record the source commit and build command in the manifest's provenance entry.
3. Copy the released DLL/bundle into its existing location. Do not hand-edit the
   generated frontend bundle.
4. Update the corresponding artifact hashes with `Get-FileHash -Algorithm SHA256`
   or another SHA-256 tool, and run the checksum verifier.
5. Run frontend lint/tests/build and all backend regression suites before releasing.

Application releases use `npm ci` and the committed lockfile. Keep the source
commit, build logs, and manifest with release artifacts so future dependency
updates can be traced.
