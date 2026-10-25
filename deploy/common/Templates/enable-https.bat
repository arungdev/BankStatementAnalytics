@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\deploy-ssh.ps1" -EnableHttpsOnly %*
set "HTTPS_EXIT=%ERRORLEVEL%"
echo.
if not "%HTTPS_EXIT%"=="0" echo HTTPS startup failed. Read the error above.
pause
exit /b %HTTPS_EXIT%
