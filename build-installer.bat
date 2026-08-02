@echo off
call "%~dp0Common.Framework\Installer\build-installer.bat" "%~dp0BankStatementAnalytics\Installer\installer.config.bat"
if errorlevel 1 (
    pause
    exit /b 1
)

rem Second artifact from the same publish output: a portable ZIP (no installer,
rem no service, everything under the extracted folder). See build-portable.ps1.
call "%~dp0BankStatementAnalytics\Installer\build-portable.bat"
if errorlevel 1 (
    pause
    exit /b 1
)

echo Check Setup\ for the compiled installer and the portable ZIP.
pause
