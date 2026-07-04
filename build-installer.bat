@echo off
call "%~dp0Common.Framework\Installer\build-installer.bat" "%~dp0BankStatementAnalytics\Installer\installer.config.bat"
if errorlevel 1 (
    pause
    exit /b 1
)
echo Check Setup\ for the compiled installer.
pause
