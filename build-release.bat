@echo off
setlocal
rem No arguments opens the options menu. Arguments allow unattended builds.
if "%~1"=="" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-release.ps1" -Interactive
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-release.ps1" %*
)
set "RELEASE_EXIT=%ERRORLEVEL%"
echo.
if not "%RELEASE_EXIT%"=="0" echo Release failed. Read the error above; do not distribute partial artifacts.
pause
exit /b %RELEASE_EXIT%
