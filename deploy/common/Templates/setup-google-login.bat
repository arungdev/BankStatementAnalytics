@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\setup-google-ssh.ps1" %*
set "GOOGLE_EXIT=%ERRORLEVEL%"
echo.
if not "%GOOGLE_EXIT%"=="0" echo Google setup failed. Read the message above; an application upgrade may be required.
pause
exit /b %GOOGLE_EXIT%
