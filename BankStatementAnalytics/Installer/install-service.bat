@echo off
rem ============================================================================
rem Registers BankStatementAnalytics.exe as a Windows service.
rem
rem Drop this next to the published BankStatementAnalytics.exe (it is published
rem into Publish\ next to the exe) and run it. It self-elevates to admin, which
rem the Service Control Manager requires.
rem
rem Pass /silent to suppress the closing "pause" (used when the Inno installer
rem invokes this so it doesn't hang on a hidden window).
rem
rem The exe is service-aware via builder.Host.UseWindowsService() in Program.cs,
rem so the SAME exe still runs interactively (double-click / desktop shortcut)
rem when not launched by the SCM.
rem ============================================================================
setlocal

set "SERVICE_NAME=BankStatementAnalytics"
set "DISPLAY_NAME=Bank Statement Analytics"
set "EXE=%~dp0BankStatementAnalytics.exe"
rem Must match the port the Release build binds (appsettings.json "Urls"); used only
rem for the description/messages below. The bind itself comes from appsettings.json.
set "APP_URL=http://localhost:5080"

rem Run under the built-in, NON-admin LocalService account. This is required: the
rem app's bundled PostgreSQL (postgres.exe/initdb.exe) refuses to start under an
rem administrative token, so the default LocalSystem account would break the DB.
set "SERVICE_ACCOUNT=NT AUTHORITY\LocalService"

rem App install folder (this script's own dir). LocalService needs read/execute on
rem the pgsql binaries and write access to create Data\ and Uploads\ here.
set "APP_DIR=%~dp0"
if "%APP_DIR:~-1%"=="\" set "APP_DIR=%APP_DIR:~0,-1%"

rem Suppress the closing prompt when invoked non-interactively (installer passes /silent).
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

if not exist "%EXE%" (
    echo ERROR: Could not find "%EXE%".
    echo Place this script in the same folder as BankStatementAnalytics.exe.
    %PAUSE_CMD%
    exit /b 1
)

rem --- Remove any prior registration so this acts as install-or-update. Do it robustly: a
rem --- crash-looping or previously-stuck service can sit in the "marked for deletion" (Disabled)
rem --- state, which makes a plain delete-then-create fail with "marked for deletion". Disable
rem --- auto-restart + start type, stop, force-kill the process if it won't stop, delete, then
rem --- wait until the SCM has actually dropped it before creating a fresh one. ---
sc query "%SERVICE_NAME%" >nul 2>&1
if %errorlevel% neq 0 goto no_prior_service

echo Existing service found - stopping and removing it first...
sc failure "%SERVICE_NAME%" reset= 0 actions= "" >nul 2>&1
sc config "%SERVICE_NAME%" start= disabled >nul 2>&1
sc stop "%SERVICE_NAME%" >nul 2>&1

set /a _tries=0
:wait_stop
sc query "%SERVICE_NAME%" | find "STOPPED" >nul
if %errorlevel% equ 0 goto do_delete
set /a _tries+=1
if %_tries% geq 20 goto force_kill
timeout /t 1 /nobreak >nul
goto wait_stop

:force_kill
echo Service did not stop in time; force-killing its process...
for /f "tokens=2 delims=:" %%P in ('sc queryex "%SERVICE_NAME%" ^| find "PID"') do call :trim %%P
if defined SVC_PID if not "%SVC_PID%"=="0" taskkill /PID %SVC_PID% /F /T >nul 2>&1
timeout /t 2 /nobreak >nul

:do_delete
sc delete "%SERVICE_NAME%" >nul 2>&1

set /a _tries=0
:wait_gone
sc query "%SERVICE_NAME%" >nul 2>&1
if %errorlevel% neq 0 goto no_prior_service
set /a _tries+=1
if %_tries% geq 15 goto delete_stuck
timeout /t 1 /nobreak >nul
goto wait_gone

rem If it still won't go away, the SCM has it "marked for deletion" because another program holds
rem an open handle - almost always an open Services console (services.msc) or Task Manager's
rem Services tab. Retrying won't delete it until those close, and sc create would then fail with
rem "marked for deletion", so stop here with a clear instruction instead of a cryptic error.
:delete_stuck
echo.
echo ============================================================
echo ERROR: "%SERVICE_NAME%" is stuck in the "marked for deletion" state.
echo A program is holding a handle to it - close the Services window
echo (services.msc) AND Task Manager, then run this installer again.
echo ============================================================
%PAUSE_CMD%
exit /b 1

:no_prior_service

rem Grant LocalService (well-known SID S-1-5-19, language-independent) modify rights on the app
rem folder. The app keeps all its writable state (Data\ = DB/keys/pgsql-data, Uploads\, Logs\)
rem right under this install directory, so the service account needs write access here - plus
rem read/execute on the bundled pgsql binaries.
echo Granting LocalService write access to "%APP_DIR%"...
icacls "%APP_DIR%" /grant *S-1-5-19:(OI)(CI)M /T /C >nul

echo Creating service "%SERVICE_NAME%"...
sc create "%SERVICE_NAME%" binPath= "\"%EXE%\"" start= auto obj= "%SERVICE_ACCOUNT%" password= "" DisplayName= "%DISPLAY_NAME%"
if %errorlevel% neq 0 (
    echo ERROR: Failed to create the service.
    %PAUSE_CMD%
    exit /b 1
)

sc description "%SERVICE_NAME%" "Parses bank statement exports and serves the analytics web app at %APP_URL%."

rem Force the Production environment so the app reads appsettings.json (which sets the
rem 5080 port) rather than any Development config. The port itself is intentionally NOT
rem pinned here - appsettings.json is the single source of truth for it.
reg add "HKLM\SYSTEM\CurrentControlSet\Services\%SERVICE_NAME%" /v Environment /t REG_MULTI_SZ /d "ASPNETCORE_ENVIRONMENT=Production" /f >nul

rem Auto-restart on crash: 5s, 5s, then 60s; reset the failure counter daily.
sc failure "%SERVICE_NAME%" reset= 86400 actions= restart/5000/restart/5000/restart/60000 >nul

echo Starting service...
sc start "%SERVICE_NAME%"

echo.
echo ============================================================
echo Done. "%DISPLAY_NAME%" is registered to start automatically
echo on boot and is available at %APP_URL%
echo ============================================================
%PAUSE_CMD%
exit /b 0

rem --- Helper: strip leading spaces from an sc queryex PID token -----------------
:trim
set "SVC_PID=%~1"
goto :eof
