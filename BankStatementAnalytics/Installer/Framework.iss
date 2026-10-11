; ============================================================================
; Product-owned copy of the Common.Framework Inno Setup engine.
; Copied from Common.Framework/Installer/Framework.iss on 2026-10-11.
; Service scripts are executed by the already elevated installer, and failures
; abort installation instead of silently reporting success.
;
; This file is NOT compiled on its own. A product repo defines the macros
; below (and its own [Setup] AppId line) in a small product .iss file, then
; #includes this file. See Common.Framework/Installer/README.md for the
; full contract and a copy-paste starting point.
;
; Required macros (the include below fails with a clear error if missing):
;   MyAppName, MyAppVersion, MyAppPublisher, MyAppExeName, MySourceDir
;
; Optional macros (sensible defaults applied here if not defined):
;   MyAppURL, MyOutputDir, MyOutputBaseFilename, MyIconFile,
;   MyInstallScope ("user" default | "machine"), MyPreserveFolders
; ============================================================================

#ifndef MyAppName
  #error "Define MyAppName before including Framework.iss"
#endif
#ifndef MyAppVersion
  #error "Define MyAppVersion before including Framework.iss"
#endif
#ifndef MyAppPublisher
  #error "Define MyAppPublisher before including Framework.iss"
#endif
#ifndef MyAppExeName
  #error "Define MyAppExeName before including Framework.iss"
#endif
#ifndef MySourceDir
  #error "Define MySourceDir (path to the published output folder) before including Framework.iss"
#endif

#ifndef MyAppURL
  #define MyAppURL ""
#endif
#ifndef MyOutputDir
  #define MyOutputDir "Output"
#endif
#ifndef MyOutputBaseFilename
  #define MyOutputBaseFilename MyAppName + "-Setup-" + MyAppVersion
#endif
#ifndef MyIconFile
  #define MyIconFile ""
#endif
#ifndef MyInstallScope
  #define MyInstallScope "user"
#endif
#ifndef MyPreserveFolders
  #define MyPreserveFolders "Data,Uploads"
#endif
; Optional Windows-service feature (off unless the product defines the script names).
; The scripts must be packaged into {app} (i.e. present in MySourceDir). When set,
; Setup offers a "run as a background service" task; selecting it runs the install
; script and suppresses the interactive post-install launch. The uninstall script
; (if defined) always runs on uninstall - it should no-op when no service exists.
;
; Define MyServiceAlways (any value) to make the service mandatory instead of an opt-in
; task: no checkbox, the install script always runs, and the interactive launch is always
; suppressed. Define MyServiceUrl (e.g. "http://localhost:5080") to point the Start-menu /
; desktop shortcuts at that URL instead of the exe - correct for a service the user reaches
; through a browser rather than by launching a second instance of the exe.
#ifndef MyServiceInstallScript
  #define MyServiceInstallScript ""
#endif
#ifndef MyServiceUninstallScript
  #define MyServiceUninstallScript ""
#endif

[Setup]
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
#if MyAppURL != ""
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
#endif
; Named mutex the host app should create (see README) so Setup can detect
; a running instance and prompt the user to close it before install/uninstall.
;
; Skipped in mandatory-service mode (and whenever MyNoAppMutex is defined): there the
; running instance is a Windows service the user has no way to "close" from the desktop,
; and Setup stops/unregisters it itself (PrepareToInstall / CurUninstallStepChanged)
; before touching any file - so the prompt is an unactionable dead end.
#if !defined(MyServiceAlways) && !defined(MyNoAppMutex)
AppMutex=Global\{#MyAppExeName}
#endif
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
#if MyInstallScope == "machine"
DefaultDirName={autopf}\{#MyAppName}
PrivilegesRequired=admin
#else
DefaultDirName={localappdata}\Programs\{#MyAppName}
PrivilegesRequired=lowest
#endif
OutputDir={#MyOutputDir}
OutputBaseFilename={#MyOutputBaseFilename}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}
#if MyIconFile != ""
SetupIconFile={#MyIconFile}
#endif

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
; Define MyDesktopIconChecked (any value) to pre-check the desktop-icon task.
#ifdef MyDesktopIconChecked
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
#else
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
#endif
#if (MyServiceInstallScript != "") && !defined(MyServiceAlways)
Name: "runservice"; Description: "Run {#MyAppName} in the background as a Windows service (starts automatically at system startup)"; GroupDescription: "How to run {#MyAppName}:"; Flags: unchecked
#endif

[Files]
#if MyServiceUninstallScript != ""
; Use the new stop script before replacing locked files, including when upgrading
; an older installation whose stop script does not contain these fixes.
Source: "{#MySourceDir}\{#MyServiceUninstallScript}"; DestName: "update-stop-service.bat"; Flags: dontcopy
#endif
Source: "{#MySourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

#ifdef MyServiceUrl
[InstallDelete]
; Builds prior to URL-shortcut support created .lnk shortcuts targeting the exe (possibly
; from a per-user-scope install). They'd launch a second instance that conflicts with the
; running service, so remove them from both per-user and common locations on upgrade —
; the [Icons] entries below recreate the correct .url shortcuts.
Type: files; Name: "{userdesktop}\{#MyAppName}.lnk"
Type: files; Name: "{commondesktop}\{#MyAppName}.lnk"
Type: files; Name: "{userprograms}\{#MyAppName}\{#MyAppName}.lnk"
Type: files; Name: "{commonprograms}\{#MyAppName}\{#MyAppName}.lnk"
#endif

[Icons]
#ifdef MyServiceUrl
; Service mode: shortcuts open the app URL in the browser (launching the exe would just
; start a conflicting second instance of the already-running service). IconFilename gives
; the .url files the app's icon instead of the default browser icon.
Name: "{group}\{#MyAppName}"; Filename: "{#MyServiceUrl}"; IconFilename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{#MyServiceUrl}"; IconFilename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
#else
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
#endif

[Run]
; The Windows-service registration (install script) is invoked HIDDEN from [Code]
; (CurStepChanged / ssPostInstall) rather than here: a declarative [Run] entry with
; the shellexec flag always pops a visible cmd console window during setup. See the
; CurStepChanged procedure below.
;
; Interactive launch - suppressed in service mode, so the two don't run at once (they
; would contend for the same port and embedded database).
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent; Check: ShouldOfferInteractiveLaunch

[Code]
var
  KeepAppData: Boolean;

// True when the user chose to run the product as a Windows service. Always False
// unless the product opted into the service feature (defined MyServiceInstallScript).
function IsServiceInstallSelected(): Boolean;
begin
  Result := False;
#if MyServiceInstallScript != ""
  #ifdef MyServiceAlways
  Result := True;
  #else
  Result := IsTaskSelected('runservice');
  #endif
#endif
end;

// Gates the interactive post-install launch so it isn't offered when installing as a
// service (both would bind the same port and embedded database).
function ShouldOfferInteractiveLaunch(): Boolean;
begin
  Result := not IsServiceInstallSelected();
end;

#if MyServiceUninstallScript != ""
// Runs BEFORE any files are copied. On an upgrade, a running auto-start service holds an
// open handle to the exe/dlls, so the file copy would fail with "DeleteFile failed; code 5.
// Access is denied." on the locked exe. Stop and unregister the service first so it releases
// those handles - mirrors the uninstall path (CurUninstallStepChanged / usUninstall). The
// install script in [Run] re-creates and starts the service after the new files land.
//
// Idempotent and safe on a fresh install: the script won't exist in {app} yet (nothing to
// run), and even if present it no-ops when no service is registered. The product's
// machine-scope installer is already elevated, so no additional UAC launch is needed.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ScriptPath: String;
  ResultCode: Integer;
begin
  Result := '';
  ScriptPath := ExpandConstant('{app}\{#MyServiceUninstallScript}');
  if FileExists(ScriptPath) then
  begin
    ExtractTemporaryFile('update-stop-service.bat');
    ScriptPath := ExpandConstant('{tmp}\update-stop-service.bat');
    if not Exec(ExpandConstant('{cmd}'), '/c ""' + ScriptPath + '" /silent"',
      ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode) then
      Result := 'Could not stop the application service. Windows error: ' + IntToStr(ResultCode)
    else if ResultCode <> 0 then
      Result := 'Could not stop and unregister the application service (exit code ' + IntToStr(ResultCode) + '). Close Services and Task Manager, then retry setup.';
  end;
end;
#endif

#if MyServiceInstallScript != ""
// Registers the Windows service AFTER files are installed. Exec waits for the script,
// inherits Setup's elevated token, and lets us check its exit code. /silent prevents
// a hidden pause, and SW_HIDE keeps the script's console from flashing on screen.
procedure CurStepChanged(CurStep: TSetupStep);
var
  ScriptPath: String;
  ResultCode: Integer;
begin
  if (CurStep = ssPostInstall) and IsServiceInstallSelected() then
  begin
    ScriptPath := ExpandConstant('{app}\{#MyServiceInstallScript}');
    if FileExists(ScriptPath) then
    begin
      WizardForm.StatusLabel.Caption := 'Registering the Windows service...';
      if not Exec(ExpandConstant('{cmd}'), '/c ""' + ScriptPath + '" /silent"',
        ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode) then
        RaiseException('Could not register the application service. Windows error: ' + IntToStr(ResultCode));
      if ResultCode <> 0 then
        RaiseException('The application service failed to start (exit code ' + IntToStr(ResultCode) + '). Check the application logs before retrying.');
    end;
    if not FileExists(ScriptPath) then
      RaiseException('The application service installation script is missing.');
  end;
end;
#endif

// Splits the leading comma-separated token off Remaining and returns it trimmed.
function NextFolderToken(var Remaining: String): String;
var
  P: Integer;
begin
  Remaining := Trim(Remaining);
  P := Pos(',', Remaining);
  if P = 0 then
  begin
    Result := Remaining;
    Remaining := '';
  end
  else
  begin
    Result := Trim(Copy(Remaining, 1, P - 1));
    Remaining := Copy(Remaining, P + 1, Length(Remaining));
  end;
end;

function AnyAppDataExists(): Boolean;
var
  Remaining, Token: String;
begin
  Result := False;
  Remaining := '{#MyPreserveFolders}';
  while Remaining <> '' do
  begin
    Token := NextFolderToken(Remaining);
    if (Token <> '') and DirExists(ExpandConstant('{app}') + '\' + Token) then
      Result := True;
  end;
end;

function InitializeUninstall(): Boolean;
begin
  Result := True;
  if AnyAppDataExists() then
    KeepAppData := (MsgBox('Keep your application data (database, uploads) in' + #13#10 +
      ExpandConstant('{app}') + '?' + #13#10#13#10 +
      'Choose No to permanently delete it along with the program.',
      mbConfirmation, MB_YESNO) = IDYES)
  else
    KeepAppData := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Remaining, Token, FolderPath: String;
#if MyServiceUninstallScript != ""
  ScriptPath: String;
  ResultCode: Integer;
#endif
begin
#if MyServiceUninstallScript != ""
  // Unregister the service BEFORE files are removed, elevated and waited-on, so the
  // service has fully released the exe by the time Inno deletes it (avoids a file lock).
  // Idempotent: the script no-ops when no service is registered. Run via cmd so the
  // 'runas' verb reliably elevates the .bat; /silent suppresses its closing pause.
  if CurUninstallStep = usUninstall then
  begin
    ScriptPath := ExpandConstant('{app}\{#MyServiceUninstallScript}');
    if FileExists(ScriptPath) then
      ShellExec('runas', ExpandConstant('{cmd}'), '/c "' + ScriptPath + '" /silent',
        ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
#endif

  if (CurUninstallStep = usPostUninstall) and (not KeepAppData) then
  begin
    Remaining := '{#MyPreserveFolders}';
    while Remaining <> '' do
    begin
      Token := NextFolderToken(Remaining);
      if Token <> '' then
      begin
        FolderPath := ExpandConstant('{app}') + '\' + Token;
        if DirExists(FolderPath) then
          DelTree(FolderPath, True, True, True);
      end;
    end;
    if DirExists(ExpandConstant('{app}')) then
      RemoveDir(ExpandConstant('{app}'));
  end;
end;
