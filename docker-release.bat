@echo off
setlocal
REM docker-release.bat [unique-version] [registry/repository]
REM No repository: build locally. With repository: build and publish using docker login.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\common\publish-image.ps1" -ProjectRoot "%~dp0." %*
exit /b %ERRORLEVEL%
