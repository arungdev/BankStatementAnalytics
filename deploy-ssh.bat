@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\deploy-ssh.ps1" %*
set "DEPLOY_EXIT=%ERRORLEVEL%"
echo.
if not "%DEPLOY_EXIT%"=="0" echo Deployment failed. Read the error above before retrying.
pause
exit /b %DEPLOY_EXIT%
