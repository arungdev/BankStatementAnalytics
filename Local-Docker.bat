@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\common\local-docker.ps1" -ProjectRoot "%~dp0." %*
set "LOCAL_EXIT=%ERRORLEVEL%"
echo.
if not "%LOCAL_EXIT%"=="0" echo Local Docker failed. Read the message above.
pause
exit /b %LOCAL_EXIT%
