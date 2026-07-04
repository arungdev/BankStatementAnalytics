rem Installer build configuration for BankStatementAnalytics.
rem Consumed by Common.Framework/Installer/build-installer.bat - see that
rem folder's README.md for the full contract.

set "PROJECT=%~dp0..\BankStatementAnalytics.csproj"
set "PUBLISH_DIR=%~dp0..\..\Publish"
set "ISS_FILE=%~dp0BankStatementAnalytics.iss"
set "RID=win-x64"
