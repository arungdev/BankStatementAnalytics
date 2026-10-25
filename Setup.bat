@echo off
setlocal
echo Cloud Setup - install or update, HTTPS, and optional Google login
echo Samples are shown beside each question. Use your own passwords and credentials.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\deploy-ssh.ps1" -UnifiedSetup %*
set "SETUP_EXIT=%ERRORLEVEL%"
echo.
if not "%SETUP_EXIT%"=="0" echo Setup did not finish. Read the message above before retrying.
pause
exit /b %SETUP_EXIT%
