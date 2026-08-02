<#
.SYNOPSIS
    Packages the already-published app into a portable ZIP (no installer, no service).

.DESCRIPTION
    Runs after the Inno Setup installer has been built, over the same `dotnet publish`
    output the installer packages, so both artifacts always come from one build.

    The ZIP contains a single top-level folder (so extracting into Downloads doesn't
    scatter files) holding the published app, the embedded PostgreSQL bundle under
    pgsql\ (the same files the installer's [Files] section copies to {app}\pgsql), and
    a README.txt.

    Nothing about the app needs a "portable mode": AppPaths.ResolveWritableAppDataDirectory
    already resolves Data\ / Uploads\ / Logs\ next to the executable, and
    EmbeddedPostgresManager picks and persists its own free port per data directory, so an
    extracted copy cannot collide with an installed service's database.

    The Windows-service register/unregister scripts ARE deliberately excluded - a portable
    copy must not be able to register a service pointing at a temp/Downloads folder.
#>
[CmdletBinding()]
param(
    # dotnet publish output to package (the same folder the installer packages).
    [Parameter(Mandatory = $true)][string]$PublishDir,
    # Where the .zip is written - the same Setup\ folder as the installer .exe.
    [Parameter(Mandatory = $true)][string]$OutputDir,
    # Version read from the .csproj by the caller, so the ZIP and the installer agree.
    [Parameter(Mandatory = $true)][string]$Version,
    # Trimmed PostgreSQL binaries. Optional: without them the extracted copy can only run
    # against an external server (Database:Embedded=false).
    [string]$PgBundleDir,
    [string]$ProductName = 'Bank Statement Analytics',
    [string]$BaseName = 'BankStatementAnalytics'
)

$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 needs both: ZipArchive/ZipArchiveMode live in System.IO.Compression,
# the ZipFile/ZipFileExtensions helpers in System.IO.Compression.FileSystem.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (-not (Test-Path -LiteralPath $PublishDir)) {
    throw "Publish folder not found: $PublishDir"
}
$publishRoot = (Resolve-Path -LiteralPath $PublishDir).ProviderPath

if (-not (Test-Path -LiteralPath $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}
$outputRoot = (Resolve-Path -LiteralPath $OutputDir).ProviderPath

# Folder name seen after extracting, and the artifact name next to the installer .exe.
$rootName = "$BaseName-$Version-portable"
$zipPath = Join-Path $outputRoot "$BaseName-Portable-$Version.zip"

# Service registration is an installed-copy concern only - see the note above.
$excludedFiles = @('install-service.bat', 'uninstall-service.bat')

$readme = @"
$ProductName $Version - portable build
$('=' * 60)

Unzip and run the executable directly. Nothing is written outside the folder
you extract it to. No service is registered, so the app runs only while the
window is open.

RUNNING
  1. Extract this folder somewhere you can write to (Documents, a USB drive -
     NOT Program Files, and preferably not straight inside the ZIP viewer).
  2. Double-click $BaseName.exe. A console window opens and stays open;
     closing it stops the app.
  3. Browse to http://localhost:5080
  4. First run creates the local database - it can take a minute. The console
     is done when it prints that the application has started.

  Do NOT run it as administrator: the bundled PostgreSQL server refuses to
  start under an elevated account.

  If Windows SmartScreen blocks the exe (it is unsigned), choose
  "More info" -> "Run anyway".

WHERE YOUR DATA LIVES
  Everything stays inside this folder:
    Data\      local PostgreSQL database, encryption keys, safety backups
    Uploads\   the statement files you import
    Logs\      application log
  Nothing is written to the registry, AppData or Program Files. To remove the
  app, close the window and delete this folder. To move or back it up, copy
  the whole folder (with the app closed).

  Closing the window also shuts the database down. If the app ever ends
  abnormally, a postgres.exe from this folder can be left behind and the
  folder won't delete - end it in Task Manager first.

  The only exception: .NET unpacks the single-file executable into your TEMP
  folder on first run. That is a cache - Windows clears it, and it holds no
  data of yours.

PORT 5080
  If you also have the installed (service) version running, it already owns
  http://localhost:5080 and this copy will fail to start. Either stop the
  "$BaseName" service, or open appsettings.json here and change
  "Urls" to another port, e.g. "http://localhost:5081".

  The two copies are otherwise independent - separate databases, separate
  uploads. They do not share data. Use Settings -> Backup to move data from
  one to the other.
"@

if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}

Write-Host "Creating portable package: $zipPath"

$archive = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    $level = [System.IO.Compression.CompressionLevel]::Optimal

    # Streams files straight from disk into the archive - no staging copy of the
    # ~150MB PostgreSQL bundle.
    function Add-Tree {
        param([string]$SourceRoot, [string]$EntryPrefix, [string[]]$ExcludeNames)

        $count = 0
        foreach ($file in Get-ChildItem -LiteralPath $SourceRoot -Recurse -File -Force) {
            if ($ExcludeNames -contains $file.Name) { continue }

            $relative = $file.FullName.Substring($SourceRoot.Length).TrimStart('\', '/')
            $entryName = "$EntryPrefix/$($relative -replace '\\', '/')"
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive, $file.FullName, $entryName, $level) | Out-Null
            $count++
        }
        return $count
    }

    $appFiles = Add-Tree -SourceRoot $publishRoot -EntryPrefix $rootName -ExcludeNames $excludedFiles
    Write-Host "  app files       : $appFiles"

    if ($PgBundleDir -and (Test-Path -LiteralPath $PgBundleDir)) {
        $pgRoot = (Resolve-Path -LiteralPath $PgBundleDir).ProviderPath
        $pgFiles = Add-Tree -SourceRoot $pgRoot -EntryPrefix "$rootName/pgsql" -ExcludeNames @()
        Write-Host "  PostgreSQL files: $pgFiles"
    }
    else {
        Write-Warning "PostgreSQL bundle not found ($PgBundleDir) - the portable ZIP will need an external server (Database:Embedded=false)."
    }

    # Normalize to CRLF (via String.Replace/Split, not -replace: the regex replacement
    # string would take \r\n literally) so Notepad renders the file as written, whatever
    # line endings this script happens to be stored with. No BOM - it's a plain .txt.
    $readmeCrLf = [string]::Join("`r`n", $readme.Replace("`r`n", "`n").Split("`n"))
    $entry = $archive.CreateEntry("$rootName/README.txt", $level)
    $writer = New-Object System.IO.StreamWriter($entry.Open(), (New-Object System.Text.UTF8Encoding($false)))
    try { $writer.Write($readmeCrLf) }
    finally { $writer.Dispose() }
}
finally {
    $archive.Dispose()
}

$sizeMb = [math]::Round((Get-Item -LiteralPath $zipPath).Length / 1MB, 1)
Write-Host "Portable ZIP built: $zipPath ($sizeMb MB)"
