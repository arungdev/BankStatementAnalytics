@echo off
rem ============================================================================
rem Stops and unregisters the BankStatementAnalytics Windows service.
rem Self-elevates to admin. Does NOT delete the app files or its data
rem (Data/, Uploads/) - only the service registration.
rem
rem Pass /silent to suppress the closing "pause" (the Inno uninstaller invokes
rem this elevated-and-waited, before removing files, so the exe is unlocked).
rem ============================================================================
setlocal

set "SERVICE_NAME=BankStatementAnalytics"

rem Suppress the closing prompt when invoked non-interactively (uninstaller passes /silent).
set "PAUSE_CMD=pause"
if /i "%~1"=="/silent" set "PAUSE_CMD=rem"

rem Preserve args so self-elevation re-launches with the same /silent flag.
set "ELEV_ARGS=%*"

rem --- Self-elevate to administrator ----------------------------------------
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator privileges...
    if defined ELEV_ARGS (
        powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs -ArgumentList '%ELEV_ARGS%'"
    ) else (
        powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    )
    exit /b
)

sc query "%SERVICE_NAME%" >nul 2>&1
if %errorlevel% neq 0 (
    echo Service "%SERVICE_NAME%" is not registered. Nothing to do.
    %PAUSE_CMD%
    exit /b 0
)

rem Stop auto-restart first. If the app is crash-looping, the SCM's failure actions keep
rem relaunching it, so a plain stop-then-delete races a fresh process and leaves the service
rem stuck in the "marked for deletion" (Disabled) state. Clear the failure actions and disable
rem the start type so nothing respawns while we tear it down.
echo Disabling auto-restart...
sc failure "%SERVICE_NAME%" reset= 0 actions= "" >nul 2>&1
sc config "%SERVICE_NAME%" start= disabled >nul 2>&1

echo Stopping service...
sc stop "%SERVICE_NAME%" >nul 2>&1

rem Wait up to ~30s for it to actually reach STOPPED before deleting.
set /a _tries=0
:waitstop
sc query "%SERVICE_NAME%" | find "STOPPED" >nul
if %errorlevel% equ 0 goto stopped
set /a _tries+=1
if %_tries% geq 30 goto forcekill
timeout /t 1 /nobreak >nul
goto waitstop

:forcekill
echo Service did not stop in time; force-killing its process...
for /f "tokens=2 delims=:" %%P in ('sc queryex "%SERVICE_NAME%" ^| find "PID"') do call :trim %%P
if defined SVC_PID if not "%SVC_PID%"=="0" taskkill /PID %SVC_PID% /F /T >nul 2>&1
timeout /t 2 /nobreak >nul

:stopped
echo Removing service...
sc delete "%SERVICE_NAME%" >nul 2>&1

rem Confirm it's really gone. If a handle is still open (e.g. services.msc / Task Manager's
rem Services tab), Windows keeps it marked-for-deletion until those close - tell the user.
sc query "%SERVICE_NAME%" >nul 2>&1
if %errorlevel% equ 0 (
    echo.
    echo WARNING: "%SERVICE_NAME%" is still marked for deletion. Close the Services window
    echo ^(services.msc^) and Task Manager's Services tab, then re-run this script.
    %PAUSE_CMD%
    exit /b 1
)

echo.
echo Service "%SERVICE_NAME%" removed.
%PAUSE_CMD%
exit /b 0

rem --- Helper: strip leading spaces from an sc queryex PID token -----------------
:trim
set "SVC_PID=%~1"
goto :eof
