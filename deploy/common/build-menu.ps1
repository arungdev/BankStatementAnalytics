param([Parameter(Mandatory=$true)][string]$ProjectRoot, [Parameter(Mandatory=$true)][string]$ConfigFile, [switch]$PlanOnly)
$ErrorActionPreference = 'Stop'
function Read-BuildChoice([string]$Prompt, [string[]]$Allowed, [string]$Default) {
    while ($true) {
        $answer = (Read-Host $Prompt).Trim().ToLowerInvariant()
        if (-not $answer) { $answer = $Default }
        if ($Allowed -contains $answer) { return $answer }
        Write-Host ('Choose ' + ($Allowed -join ', ') + '.')
    }
}
$config = Import-PowerShellDataFile -LiteralPath $ConfigFile
$projectPath = Join-Path $ProjectRoot $config.ProjectFile
$current = @(([xml](Get-Content -Raw $projectPath)).Project.PropertyGroup.Version | Where-Object { $_ })[0]
Write-Host "`n$($config.ProductName) - Build options"
Write-Host "Current version: $current"
Write-Host ''
Write-Host 'What do you want to build?'
Write-Host '  [1] Standalone app EXE  - one app file, saved in the Publish folder'
Write-Host '  [2] Build packages      - installer EXE plus portable and cloud packages'
Write-Host '  [3] Update installed app - build, then run setup for Program Files (admin needed)'
Write-Host '  [0] Exit'
$buildType = Read-BuildChoice 'Type 1, 2 or 3, then press Enter (Enter selects option 1)' @('0','1','2','3') '1'
if ($buildType -eq '0') { return }
if ($buildType -eq '1') {
    $selection = @{ BuildType='StandaloneExe'; ProjectRoot=$ProjectRoot }
    if ($PlanOnly) { return $selection }
    Write-Host "`nBuilding standalone app EXE. Output folder: $ProjectRoot/Publish"
    $standaloneCommand = if ($config.StandaloneBuildCommand) { $config.StandaloneBuildCommand } else { 'build.bat' }
    $buildCommand = Join-Path $ProjectRoot $standaloneCommand
    & $env:ComSpec /d /c "`"$buildCommand`""
    if ($LASTEXITCODE -ne 0) { throw "Standalone EXE build failed with exit code $LASTEXITCODE." }
    return
}
Write-Host "Docker repository: $($config.DockerRepository)"
Write-Host 'Release package output: Windows installer EXE, portable ZIP and online cloud setup ZIP.'
$mode = '1'
if ($buildType -eq '2') {
    Write-Host '  [1] Build release packages on this computer (no upload)'
    Write-Host '  [2] Build and publish to Docker Hub'
    Write-Host '  [0] Back to the build choices'
    $mode = Read-BuildChoice 'Type 1 or 2, then press Enter (Enter selects option 1)' @('0','1','2') '1'
}
if ($mode -eq '0') { return }
$selection = @{ ProjectRoot=$ProjectRoot; ConfigFile=$ConfigFile; Publish=($mode -eq '2') }
if ($buildType -eq '3') {
    $selection.KeepVersion = $true
    Write-Host "Update version: $current (current project version)"
    Write-Host 'Only the installer needed to update the installed app will be built.'
} else {
    Write-Host '1 = Keep current version, 2 = Next unused version when publishing, 3 = Enter version'
    $defaultVersion = if ($mode -eq '2') { '2' } else { '1' }
    $versionMode = Read-BuildChoice "Version option (sample: 1; Enter=$defaultVersion)" @('1','2','3') $defaultVersion
    if ($versionMode -eq '2' -and $mode -ne '2') { throw 'Automatic unused version selection requires publishing. Choose keep or enter a version for local builds.' }
    $selection.KeepVersion = $versionMode -ne '2'
    if ($versionMode -eq '3') {
        do {
            $requested = (Read-Host 'Application version (sample: 4.0.0)').Trim()
            if ($requested -notmatch '^\d+\.\d+\.\d+$') { Write-Host 'Enter three numbers, such as 4.0.0.' }
        } while ($requested -notmatch '^\d+\.\d+\.\d+$')
        $selection.Version = $requested
    }
    $selection.Offline = (Read-BuildChoice 'Also create offline cloud ZIP with Docker image? (sample: n; Enter=n)' @('y','n') 'n') -eq 'y'
    $selection.ExportImage = $selection.Offline -or ((Read-BuildChoice 'Also save Docker image as a TAR file? (sample: n; Enter=n)' @('y','n') 'n') -eq 'y')
}
if ($mode -eq '2') { Write-Host 'Publishing uses your existing docker login. If needed, run docker login before this build.' }
$versionDescription = if ($selection.Version) { $selection.Version } elseif ($selection.KeepVersion) { $current } else { "next unused, starting at $current" }
if ($buildType -eq '3') {
    Write-Host "`nBuild and install version $versionDescription to C:\Program Files\Bank Statement Analytics?"
} else {
    Write-Host "`nVersion: $versionDescription | Upload: $($selection.Publish) | Image TAR: $($selection.ExportImage) | Offline ZIP: $($selection.Offline)"
}
if ($selection.Publish -and $selection.KeepVersion) { Write-Host 'An existing published tag will be rejected; it will not be overwritten.' }
if ((Read-BuildChoice 'Start build? (sample: y; Enter=y)' @('y','n') 'y') -eq 'n') { return }
if ($PlanOnly) { return $selection }
& "$PSScriptRoot/build-release.ps1" @selection
if ($buildType -eq '3') {
    if ($selection.Publish) { throw 'Choose a local build to install your update. Publishing is not supported for this option.' }
    $installVersion = if ($selection.Version) { $selection.Version } else { $current }
    $installer = Join-Path $ProjectRoot "Setup\Candidates\$installVersion\BankStatementAnalytics-Setup-$installVersion.exe"
    if (-not (Test-Path -LiteralPath $installer)) { throw "Build finished, but the installer was not found: $installer" }
    Write-Host "`nStarting setup for C:\Program Files\Bank Statement Analytics. Approve the Windows administrator prompt to install the update."
    $setup = Start-Process -FilePath $installer -Verb RunAs -Wait -PassThru
    if ($setup.ExitCode -ne 0) { throw "Installer exited with code $($setup.ExitCode)." }
}
