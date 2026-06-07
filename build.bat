@echo off
echo Building React Frontend and .NET Backend as a single EXE...

cd /d "%~dp0BankStatementAnalytics"

dotnet publish BankStatementAnalytics.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeAllContentForSelfExtract=true -o "..\Publish"

echo.
echo ====================================================
echo Build complete! Your single file EXE is located in:
echo %~dp0Publish
pause