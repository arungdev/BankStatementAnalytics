@echo off
REM Builds the BankStatementAnalytics Docker image and optionally pushes it to a registry.
REM
REM Usage:
REM   docker-release.bat [version] [registry/repo]
REM
REM Examples:
REM   docker-release.bat                                     (builds bankstatementanalytics:1.0.0 locally, no push)
REM   docker-release.bat 1.1.0                                (builds bankstatementanalytics:1.1.0 locally, no push)
REM   docker-release.bat 1.1.0 myuser/bankstatementanalytics  (builds, tags, and pushes to Docker Hub/GHCR/ACR/etc.)

setlocal

set VERSION=%1
if "%VERSION%"=="" set VERSION=1.0.0

set REGISTRY=%2

cd /d "%~dp0"

echo Building bankstatementanalytics:%VERSION% ...
docker build -t bankstatementanalytics:%VERSION% -t bankstatementanalytics:latest .
if errorlevel 1 (
    echo Docker build failed.
    pause
    exit /b 1
)

if "%REGISTRY%"=="" (
    echo.
    echo Build complete: bankstatementanalytics:%VERSION%
    echo No registry supplied - skipping push. Pass a registry/repo as the 2nd argument to push, e.g.:
    echo   docker-release.bat %VERSION% myuser/bankstatementanalytics
    pause
    exit /b 0
)

echo.
echo Tagging for %REGISTRY% ...
docker tag bankstatementanalytics:%VERSION% %REGISTRY%:%VERSION%
docker tag bankstatementanalytics:%VERSION% %REGISTRY%:latest

echo Make sure you are logged in ^(docker login^) before this push proceeds.
pause

echo Pushing %REGISTRY%:%VERSION% ...
docker push %REGISTRY%:%VERSION%
if errorlevel 1 (
    echo Docker push failed.
    pause
    exit /b 1
)

docker push %REGISTRY%:latest
if errorlevel 1 (
    echo Docker push of 'latest' tag failed.
    pause
    exit /b 1
)

echo.
echo ====================================================
echo Pushed %REGISTRY%:%VERSION% and %REGISTRY%:latest
pause
