@echo off
setlocal
echo Update existing server using its saved domain, HTTPS email and Google settings.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\deploy-ssh.ps1" -UpdateExisting %*
set "UPDATE_EXIT=%ERRORLEVEL%"
echo.
if not "%UPDATE_EXIT%"=="0" echo Update failed. Read the error above.
pause
exit /b %UPDATE_EXIT%
