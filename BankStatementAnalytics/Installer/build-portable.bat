@echo off
setlocal enabledelayedexpansion

rem ============================================================================
rem Packages the current Publish\ output as a portable ZIP into Setup\.
rem
rem Called by the repo-root build-installer.bat after the installer is compiled,
rem so both artifacts come from the same publish. Can also be run on its own to
rem repackage an existing Publish\ folder without republishing.
rem
rem The heavy lifting (and the reasoning) lives in build-portable.ps1.
rem ============================================================================

set "PROJECT="
set "PUBLISH_DIR="
call "%~dp0installer.config.bat"

if not exist "%PUBLISH_DIR%" (
    echo ERROR: Publish folder not found: %PUBLISH_DIR%
    echo        Run build-installer.bat ^(or build.bat^) first.
    exit /b 1
)

rem Same <Version> the installer uses, read from the same .csproj.
set "APPVERSION="
for /f "usebackq tokens=* delims=" %%V in (`powershell -NoProfile -Command "(Select-String -Path '%PROJECT%' -Pattern '<Version>(.*)</Version>').Matches.Groups[1].Value"`) do set "APPVERSION=%%V"
if not defined APPVERSION set "APPVERSION=1.0.0"

echo.
echo ============================================
echo  Building portable ZIP ^(version %APPVERSION%^)
echo ============================================

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-portable.ps1" ^
    -PublishDir "%PUBLISH_DIR%" ^
    -OutputDir "%~dp0..\..\Setup" ^
    -Version "%APPVERSION%" ^
    -PgBundleDir "%~dp0..\..\Common.Framework\Installer\PgBundle"
if errorlevel 1 (
    echo ERROR: Portable ZIP build failed.
    exit /b 1
)

exit /b 0
