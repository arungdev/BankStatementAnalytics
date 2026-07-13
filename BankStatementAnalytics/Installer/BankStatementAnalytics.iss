; Product-specific Inno Setup config for BankStatementAnalytics.
; Generic install/uninstall/shortcut logic lives in the shared
; Common.Framework/Installer/Framework.iss engine — see that folder's
; README.md for the full macro contract.
;
; MyAppVersion is passed in from build-installer.bat (read from the .csproj's
; <Version>), so it doesn't need to be hand-edited here on every release.

#define MyAppName      "Bank Statement Analytics"
#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif
#define MyAppPublisher "Arun G"
#define MyAppExeName   "BankStatementAnalytics.exe"
#define MySourceDir    "..\..\Publish"
; Setup wizard / Add-Remove-Programs icon (Framework.iss maps this to SetupIconFile).
; Path is relative to this .iss file.
#define MyIconFile     "..\icons\AppIcon.ico"

; Install machine-wide under C:\Program Files (requires admin). Needed because the app
; runs as a Windows service under LocalService, which can't reach a per-user profile
; install; install-service.bat grants LocalService write access to Data\ / Uploads\ here.
#define MyInstallScope "machine"

; Always register as a Windows service - no opt-in checkbox. install-service.bat runs
; under the non-admin LocalService account (required by the embedded PostgreSQL, which
; won't run as an administrator). Because MyServiceAlways is set, Setup skips the task
; prompt, suppresses the interactive post-install launch, and points the shortcuts at
; the app URL below instead of the exe (so clicking them opens the running service).
#define MyServiceInstallScript   "install-service.bat"
#define MyServiceUninstallScript "uninstall-service.bat"
#define MyServiceAlways
#define MyServiceUrl "http://localhost:5080"
; Pre-check the desktop-icon task: the shortcut is just a browser link to the service
; URL, and users expect it after install (an unchecked box left older stale shortcuts
; in place with nothing replacing them).
#define MyDesktopIconChecked
; Must NOT be nested inside MySourceDir - Files packages MySourceDir\* recursively,
; so an OutputDir underneath it would try to include its own prior output.
#define MyOutputDir    "..\..\Setup"

; Trimmed PostgreSQL 18.4 win-x64 binaries (bin/lib/share only, no pgAdmin/docs/headers),
; extracted from the official EDB installer via its --extract-only mode, committed under
; Common.Framework/Installer/PgBundle (~150MB). Regenerate by running the EDB installer with:
; --mode unattended --extract-only 1 --prefix <folder>, then copy just bin/, lib/, share/ out
; of it. Bundled here so the app can run a fully local, embedded Postgres instance with no
; separate install/Docker required - see Common.Framework/Data/EmbeddedPostgresManager.cs.
#ifndef PgsqlBundleDir
  #define PgsqlBundleDir "..\..\Common.Framework\Installer\PgBundle"
#endif

[Setup]
; Fixed GUID for this product - do not change between releases, or upgrades
; will be seen as a different app (install side-by-side instead of updating).
AppId={{5FE7BEC0-D13C-4A11-BFAA-4DDB8770E5F3}

#include "..\..\Common.Framework\Installer\Framework.iss"

[Files]
Source: "{#PgsqlBundleDir}\*"; DestDir: "{app}\pgsql"; Flags: ignoreversion recursesubdirs createallsubdirs
