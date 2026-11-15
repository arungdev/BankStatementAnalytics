@echo off
setlocal
cd /d "%~dp0BankStatementAnalytics"
if errorlevel 1 (
  echo ERROR: Could not open the application project folder.
  pause
  exit /b 1
)

echo.
echo Building the standalone Windows app EXE...
echo This can take a few minutes. The output will be saved in:
echo %~dp0Publish
echo.
dotnet publish BankStatementAnalytics.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeAllContentForSelfExtract=true -o "..\Publish"
if errorlevel 1 (
  echo.
  echo ERROR: The standalone EXE build failed. Read the messages above.
  pause
  exit /b 1
)

echo.
echo Build complete. Your standalone app EXE is in:
echo %~dp0Publish
pause
exit /b 0
