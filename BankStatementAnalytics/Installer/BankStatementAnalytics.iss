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
; Must NOT be nested inside MySourceDir - Files packages MySourceDir\* recursively,
; so an OutputDir underneath it would try to include its own prior output.
#define MyOutputDir    "..\..\Setup"

[Setup]
; Fixed GUID for this product - do not change between releases, or upgrades
; will be seen as a different app (install side-by-side instead of updating).
AppId={{5FE7BEC0-D13C-4A11-BFAA-4DDB8770E5F3}

#include "..\..\Common.Framework\Installer\Framework.iss"
